import type { YggdrasilConfig } from "@yggdrasil/config";
import { registerGitMethods } from "./git-methods.js";
import { registerProjectMethods } from "./project-methods.js";
import { registerTerminalMethods } from "./terminal-methods.js";
import { registerAgentMethods } from "./agents-methods.js";
import { registerPhoneMethods } from "./phone-methods.js";
import { registerFsMethods } from "./fs-methods.js";
import { registerConfigMethods } from "./config-methods.js";
import { QUEUEABLE_TOOLS, drainDeviceQueue, type QueuedCall } from "./assistant/deviceQueue.js";
import type { AssistantServices } from "./assistant/services.js";
import { isLoopbackAddress } from "./loopbackTrust.js";
import { isDeviceTrusted, loadTrustedDevices, setDeviceTrusted } from "./trustedDevices.js";
import { buildSessionKey, isGatewayAuthRequired, mergeAgentSources, readGlobalAgents } from "@yggdrasil/config";
import type { ChannelManager } from "./channel-manager.js";
import type { GatewayHandlerContext, GatewayRequest, GatewayResponse, ToolApprovalHandler } from "@yggdrasil/sdk";
import { CURRENT_PLUGIN_API_VERSION } from "@yggdrasil/sdk";
import { randomUUID } from "node:crypto";
import {
  createConsoleLogger,
  createEventBus,
  getKernelContext,
  getRegistry,
  listChannels,
  listPlugins,
} from "@yggdrasil/kernel";
import { ingestInboundMessage, runChannelTurn, compactSessionNow } from "@yggdrasil/pipeline";
import type { SessionStore } from "@yggdrasil/sessions";
import { getSessionStore } from "@yggdrasil/sessions";
import { listTools, resolveTools, setDeviceToolProvider } from "@yggdrasil/tools-runtime";
import type { AgentToolDefinition, ApprovalMode, ToolParameterSchema, ToolRiskLevel } from "@yggdrasil/tools-sdk";
import { pushTurnLog, getTurnLogSnapshot } from "./turn-log.js";
import { createActiveTurnTracker, type ActiveTurnTracker } from "./activeTurns.js";

export type GatewayContext = {
  config: YggdrasilConfig;
  workspaceRoot?: string;
  events: ReturnType<typeof createEventBus>;
  logger: ReturnType<typeof createConsoleLogger>;
  sessionStore?: SessionStore | null;
  channelManager?: ChannelManager;
  activeTurns: ActiveTurnTracker;
};

export type GatewayMethodHandler = (
  params: Record<string, unknown>,
  ctx: GatewayContext,
  // Identifies the WS connection a request arrived on (server.ts assigns one
  // per socket). Not part of GatewayContext itself — ctx is a single shared
  // object across every connection on this gateway process (handlers mutate
  // ctx.config in place, e.g. config.patch), so a per-connection value can't
  // live there without either racing concurrent connections or getting lost
  // on the next request's fresh clone. Undefined for non-WS callers
  // (invokeGatewayMethod) — methods that need it (device.tools.*) must
  // handle that case.
  connectionId?: string,
) => Promise<unknown>;

const coreMethods = new Map<string, GatewayMethodHandler>();

export function registerCoreMethod(name: string, handler: GatewayMethodHandler): void {
  coreMethods.set(name, handler);
}

// A human reading a destructive tool call's full args (or just tabbing away
// to go check something first) routinely takes longer than a minute — the
// old 60s value here was auto-denying real, still-being-considered approvals
// with no explanation shown anywhere, which just looked like the approval
// bar randomly vanishing.
const APPROVAL_TIMEOUT_MS = 10 * 60_000;
const pendingApprovals = new Map<string, { resolve: (ok: boolean) => void }>();

// Per-session tool-approval mode. Keyed by sessionKey so multiple TUI panes/
// sessions on one gateway process don't fight over a single global switch.
// Not persisted to disk — resets to "auto" per-session on gateway restart.
// See tool-loop.ts's approval decision logic.
const approvalModes = new Map<string, ApprovalMode>();
// In-flight chat.send turns by sessionKey, so chat.cancel can abort them.
const turnControllers = new Map<string, AbortController>();
function getApprovalMode(sessionKey: string): ApprovalMode {
  return approvalModes.get(sessionKey) ?? "auto";
}

// --- device-tools protocol (phone-side tools invoked by the LLM) ---
// See notes/yggdrasil-mobile/phone-gateway-connectivity-design.md section 3.
// Same pendingApprovals/events pattern as above, applied to device tool
// invocations instead of approvals. Tools are declared per-connection (not
// persisted — a reconnect must re-register) and only become invocable by the
// LLM once their connection is linked to a sessionKey, which happens the
// first time that connection sends chat.send with that sessionKey.
type DeviceToolKind = "sync" | "interactive";
type DeviceToolDecl = {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
  kind: DeviceToolKind;
};

const deviceToolsByConnection = new Map<string, DeviceToolDecl[]>();

// A stable client-generated id (SharedPreferences on the phone — see
// mobile/app/lib/services/yggdrasil_client.dart), separate from
// connectionId (a fresh randomUUID per WS socket) — lets a workflow's
// `phone.tool` node or "mobile" trigger address "that same phone" across
// reconnects, the way deviceToolsByConnection's per-socket registration
// can't. Both directions are kept (id→connectionId for lookup,
// connectionId→id for cleanup on close) since neither map alone supports
// both operations without a linear scan.
const connectionIdByDeviceId = new Map<string, string>();
const deviceIdByConnectionId = new Map<string, string>();

// Per-connection remote address, set by server.ts right after it mints a
// connectionId — used by the loopback exemption in fs-methods.ts. Same
// lifecycle/pattern as deviceToolsByConnection: keyed by connectionId,
// cleared in handleGatewayConnectionClosed.
const connectionRemoteAddress = new Map<string, string>();

export function registerConnectionRemoteAddress(connectionId: string, remoteAddress: string | undefined): void {
  if (remoteAddress === undefined) return;
  connectionRemoteAddress.set(connectionId, remoteAddress);
}

// Matches the three forms Node's dual-stack net/ws sockets report for a
// loopback peer — a plain "127.0.0.1"/"::1", or the IPv4-mapped-IPv6 form
// ("::ffff:127.0.0.1") some platforms surface once the server binds
// "0.0.0.0" (see app-desktop's gateway.ts GATEWAY_BIND_HOST).

// No connectionId, or no recorded address for it (the non-WS
// invokeGatewayMethod path — see GatewayMethodHandler's doc comment) →
// fail closed, not exempt. Only a positively-confirmed loopback socket skips
// the fs.* approval gate.
export function isLoopbackConnection(connectionId: string | undefined): boolean {
  return isLoopbackAddress(connectionRemoteAddress.get(connectionId ?? ""));
}

// The "Confiar en este dispositivo" bypass (ApprovalBar.tsx) — a connection
// whose registered device (device.tools.register) the project owner has
// explicitly trusted skips fs.* approval the same way a loopback connection
// does. Unlike isLoopbackConnection this is per-project state read from
// disk (trustedDevices.ts), not a fixed property of the socket, so revoking
// trust (PhoneLinkSection.tsx) takes effect on this same connection's very
// next call — no reconnect needed.
export async function isTrustedDeviceConnection(workspaceRoot: string | undefined, connectionId: string | undefined): Promise<boolean> {
  if (!workspaceRoot || !connectionId) return false;
  const deviceId = deviceIdByConnectionId.get(connectionId);
  if (!deviceId) return false;
  return isDeviceTrusted(workspaceRoot, deviceId);
}
const sessionKeyToConnection = new Map<string, string>();

// Push / reminders / offline-action queue (see ./assistant). Set once by the
// real gateway server; null in one-shot CLI contexts and most tests.
let assistantServices: AssistantServices | null = null;
export function setAssistantServices(services: AssistantServices | null): void {
  assistantServices = services;
}

// Whether a desktop currently keeps its tunnel socket open here (tunnel.ts),
// so desktops.list can tell the phone it is reachable from any network.
let tunnelAttached: ((desktopId: string) => boolean) | null = null;
export function setTunnelLookup(lookup: ((desktopId: string) => boolean) | null): void {
  tunnelAttached = lookup;
}

// Sync: no human in the loop on the device (open an app, list installed
// apps) — short fixed timeout. Interactive: device shows a system
// picker/dialog (SAF file picker) that can sit open for minutes waiting on
// the user — no short timeout, only a long safety ceiling in case the
// connection wedges instead of ever answering.
const DEVICE_TOOL_SYNC_TIMEOUT_MS = 30_000;
const DEVICE_TOOL_INTERACTIVE_CEILING_MS = 10 * 60_000;

const pendingDeviceToolCalls = new Map<
  string,
  {
    resolve: (result: unknown) => void;
    reject: (err: Error) => void;
    connectionId: string;
    kind: DeviceToolKind;
    timeoutHandle: ReturnType<typeof setTimeout>;
  }
>();

function invokeDeviceTool(
  events: GatewayContext["events"],
  connectionId: string,
  sessionKey: string,
  toolName: string,
  args: Record<string, unknown>,
  kind: DeviceToolKind,
): Promise<unknown> {
  const requestId = randomUUID();
  const timeoutMs = kind === "interactive" ? DEVICE_TOOL_INTERACTIVE_CEILING_MS : DEVICE_TOOL_SYNC_TIMEOUT_MS;

  const promise = new Promise<unknown>((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      if (pendingDeviceToolCalls.delete(requestId)) {
        reject(new Error(kind === "interactive" ? "device tool call exceeded safety ceiling" : "timeout"));
      }
    }, timeoutMs);
    pendingDeviceToolCalls.set(requestId, { resolve, reject, connectionId, kind, timeoutHandle });
  });

  // connectionId lets server.ts deliver this to the owning phone connection
  // only: two connections of the same phone (the app and the quick-access
  // bubble's background engine) must never both execute one tool call.
  void events.emit("device.tool.invoke.requested", { requestId, toolName, args, sessionKey, kind, connectionId });

  return promise;
}

// riskLevel-by-name mapping for device tools (design doc section 4, point
// 6). The registering client (the phone) only declares `kind` — it must not
// also get to self-assign riskLevel, same trust problem as the fs.* gap
// (whoever asks for permission shouldn't also define how much permission
// that is). An unrecognized name fails closed to "destructive", not to a
// permissive default — a typo, a stale client, or an undeclared tool name
// must never slip past the approval gate for free.
const DEVICE_TOOL_RISK_LEVELS: Record<string, ToolRiskLevel> = {
  phone_open_app: "safe",
  phone_list_installed_apps: "safe",
  phone_search_files: "safe",
  phone_list_documents: "safe",
  // "moderate", not "safe" (Architect, 2026-09-04, external-actions-and-
  // connectors-analysis.md §2.1/§6) — unlike the 4 tools above, this writes
  // real state to the user's device. search_files/list_documents get away
  // with "safe" because the SAF picker IS a human checkpoint already;
  // open_app/list_installed_apps have no side effect to begin with.
  // set_alarm has neither: ACTION_SET_ALARM has no result contract back to
  // the calling app either way, so kind is always "sync" here regardless of
  // whether the clock app happens to show its own confirmation screen — not
  // an empirical fact we can lean on the way search_files' picker is
  // guaranteed. Final, not a placeholder pending device confirmation.
  phone_set_alarm: "moderate",
  // Same tool, same reasoning, same intent shape (ACTION_SET_TIMER) —
  // Architect confirmed no difference from phone_set_alarm.
  phone_set_timer: "moderate",
  // "moderate", not "safe" — despite ACTION_INSERT on CalendarContract
  // *always* opening the Calendar app's editor for the user to save
  // (confirmed against official Android docs, not assumed by analogy with
  // set_alarm — unlike ACTION_SET_ALARM this one has no silent-save path at
  // all). Architect's final call: a checkpoint screen doesn't matter once
  // the action can reach a third party — a shared/work calendar's default
  // account turns this into a real invite/notification to someone else the
  // moment it saves, same category shift the external-actions doc already
  // draws for gmail_send-style actions. No amount of local confirmation UI
  // moves that back to "safe".
  phone_add_calendar_event: "moderate",
  // Phase 2 device capabilities (notes/yggdrasil-mobile/on-device-workflows-design.md §2).
  phone_show_notification: "safe",
  phone_clipboard_get: "moderate",
  phone_clipboard_set: "safe",
  phone_device_state: "safe",
  phone_set_ringer_mode: "moderate",
  phone_set_volume: "moderate",
  phone_current_time: "safe",
  phone_flashlight: "safe",
  phone_media_play: "moderate",
  phone_get_location: "moderate",
  // Sends without review — destructive, unlike the compose/dial variants that
  // leave the final tap to the user.
  phone_send_sms: "destructive",
  phone_compose_sms: "moderate",
  phone_compose_whatsapp: "moderate",
  phone_call: "destructive",
  phone_dial: "moderate",
  phone_search_contacts: "moderate",
  // Reads private data (event titles, places, notes) — same tier as contacts/location.
  phone_read_calendar: "moderate",
  phone_open_url: "safe",
  phone_share_text: "moderate",
  phone_launch_intent: "destructive",
};

/** Exported for extensions/service-workflows's `phone.tool` node — the grant preflight needs the same risk table chat's device tools already use, not a second copy of it. */
export function deviceToolRiskLevel(name: string): ToolRiskLevel {
  return DEVICE_TOOL_RISK_LEVELS[name] ?? "destructive";
}

// Builds the AgentToolDefinition[] the LLM tool loop sees for a given
// session, from whatever the session's linked connection last registered.
// Passed to tools-runtime as the device-tool provider hook so resolveTools()
// merges these into the same registry as server-side tools every turn —
// reuses the existing riskLevel/approvalMode gate in tool-loop.ts with no
// changes needed there.
function buildDeviceToolDefinitions(sessionKey: string): AgentToolDefinition[] {
  const connectionId = sessionKeyToConnection.get(sessionKey);
  const decls = connectionId ? deviceToolsByConnection.get(connectionId) : undefined;
  // No phone on this session right now (never linked, disconnected, or the chat
  // arrived over a connection that isn't a device): offer only the queueable actions.
  if (!connectionId || !decls?.length) return buildOfflineDeviceToolDefinitions(sessionKey);

  return decls.map((decl) => ({
    name: decl.name,
    description: decl.description,
    parameters: decl.parameters,
    riskLevel: deviceToolRiskLevel(decl.name),
    kind: decl.kind,
    execute: async (toolCtx, args) => {
      if (!toolCtx.events) {
        throw new Error(`device tool "${decl.name}": no event bus on this call`);
      }
      return invokeDeviceTool(toolCtx.events, connectionId, sessionKey, decl.name, args, decl.kind);
    },
  }));
}

// While the phone is away only the "do it later" actions are offered, and
// calling one just queues it (plus a push to wake the user). Approval for the
// real risk level happens at drain time, when the user is actually there — the
// enqueue itself is harmless, so it is declared "safe" to skip an approval
// prompt nobody could answer.
function buildOfflineDeviceToolDefinitions(sessionKey: string): AgentToolDefinition[] {
  const services = assistantServices;
  if (!services) return [];
  const deviceId = services.directory.deviceForSession(sessionKey);
  if (!deviceId) return [];
  return services.directory
    .toolsFor(deviceId)
    .filter((decl) => QUEUEABLE_TOOLS.has(decl.name))
    .map((decl) => ({
      name: decl.name,
      description: `[Phone is offline: this action is queued and runs when the user opens the app.] ${decl.description}`,
      parameters: decl.parameters as ToolParameterSchema,
      riskLevel: "safe" as ToolRiskLevel,
      kind: decl.kind,
      execute: async (_toolCtx, args) => {
        const call = await services.queue.enqueue({
          deviceId,
          sessionKey,
          toolName: decl.name,
          args,
          kind: decl.kind,
          riskLevel: deviceToolRiskLevel(decl.name),
        });
        await services.push.notify({
          title: "Tu asistente tiene una acción pendiente",
          body: "Abre la app para ejecutarla.",
          data: { type: "queue", sessionKey },
        });
        return {
          queued: true,
          id: call.id,
          note: "The phone is offline; the action is queued and will run (asking for approval if needed) when the user opens the app. Tell the user it is pending, not done.",
        };
      },
    }));
}

function describeQueuedCall(call: QueuedCall): string {
  const names: Record<string, string> = {
    phone_set_alarm: "alarma",
    phone_set_timer: "temporizador",
    phone_add_calendar_event: "evento de calendario",
    phone_show_notification: "notificación",
    phone_set_ringer_mode: "modo de timbre",
    phone_set_volume: "volumen",
  };
  return names[call.toolName] ?? call.toolName;
}

// Runs the queue of a phone that just (re)connected. The phone gets a moment
// to finish registering, then each call goes through the normal approval gate.
async function drainQueuedForDevice(deviceId: string, ctx: GatewayContext): Promise<void> {
  const services = assistantServices;
  if (!services) return;
  const approve = createGatewayApprovalHandler(ctx.events);
  await drainDeviceQueue({
    queue: services.queue,
    deviceId,
    approve: (call) => approve({ sessionKey: call.sessionKey, toolName: call.toolName, args: call.args, riskLevel: call.riskLevel }),
    invoke: (call) => {
      const connectionId = connectionIdByDeviceId.get(deviceId);
      if (!connectionId) return Promise.reject(new Error("device_offline"));
      return invokeDeviceTool(ctx.events, connectionId, call.sessionKey, call.toolName, call.args, call.kind);
    },
    report: async (call, outcome) => {
      const what = describeQueuedCall(call);
      const text =
        outcome.status === "done"
          ? `✅ Listo: ${what} que dejaste pendiente.`
          : outcome.status === "denied"
            ? `⚠️ No ejecuté la ${what} pendiente porque no la aprobaste.`
            : outcome.status === "expired"
              ? `⌛ La ${what} pendiente venció (más de 24 h) y no se ejecutó.`
              : `⚠️ No pude ejecutar la ${what} pendiente: ${outcome.detail}`;
      await services.postToSession(call.sessionKey, text);
    },
  });
}

/**
 * Addresses a device by its own stable `deviceId` instead of a sessionKey
 * (which a workflow run has no equivalent of) — the `phone.tool` node type
 * (extensions/service-workflows) and the "mobile" `workflows.run` trigger
 * both go through this, via @yggdrasil/tools-runtime's setDeviceToolInvoker
 * hook (wired up by service-workflows itself, which is the only thing that
 * needs it — this function is exported for that, not called from anywhere
 * else in this package).
 */
export async function invokeDeviceToolByDeviceId(
  events: GatewayContext["events"],
  deviceId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const connectionId = connectionIdByDeviceId.get(deviceId);
  if (!connectionId) throw new Error(`device_offline: no connected device with id "${deviceId}"`);
  const decl = deviceToolsByConnection.get(connectionId)?.find((d) => d.name === toolName);
  if (!decl) throw new Error(`device "${deviceId}" has not registered a tool named "${toolName}"`);
  return invokeDeviceTool(events, connectionId, `device:${deviceId}`, toolName, args, decl.kind);
}

/** Is this connection a registered device (a phone that's called device.tools.register with a deviceId)? Used by workflows.run to decide manual vs. mobile trigger — see workflows-design.md §7.1. */
export function isDeviceConnection(connectionId: string | undefined): boolean {
  return !!connectionId && deviceIdByConnectionId.has(connectionId);
}

// Called from server.ts on WS close. A pending "interactive" call can't be
// left hanging on its 10min ceiling just because the phone vanished — same
// for "sync", it's just less likely to matter given the short timeout.
export function handleGatewayConnectionClosed(connectionId: string): void {
  deviceToolsByConnection.delete(connectionId);
  connectionRemoteAddress.delete(connectionId);
  const deviceId = deviceIdByConnectionId.get(connectionId);
  if (deviceId) {
    deviceIdByConnectionId.delete(connectionId);
    // Only clear the forward entry if it still points at THIS connection —
    // a device that already reconnected (a newer connectionId claimed the
    // same deviceId) must not have its live mapping wiped by the old
    // socket's belated close event.
    if (connectionIdByDeviceId.get(deviceId) === connectionId) connectionIdByDeviceId.delete(deviceId);
  }
  for (const [sessionKey, cid] of sessionKeyToConnection) {
    if (cid === connectionId) sessionKeyToConnection.delete(sessionKey);
  }
  for (const [requestId, pending] of pendingDeviceToolCalls) {
    if (pending.connectionId === connectionId) {
      pendingDeviceToolCalls.delete(requestId);
      clearTimeout(pending.timeoutHandle);
      pending.reject(new Error("device connection closed"));
    }
  }
}

export function createGatewayApprovalHandler(events: GatewayContext["events"]): ToolApprovalHandler {
  return async (request) => {
    const requestId = randomUUID();
    const promise = new Promise<boolean>((resolve) => {
      pendingApprovals.set(requestId, { resolve });
      setTimeout(() => {
        if (pendingApprovals.delete(requestId)) {
          resolve(false);
        }
      }, APPROVAL_TIMEOUT_MS);
    });

    void events.emit("tool.approval.requested", {
      requestId,
      sessionKey: request.sessionKey,
      toolName: request.toolName,
      args: request.args,
      riskLevel: request.riskLevel,
      deviceId: request.deviceId,
    });

    const approved = await promise;

    void events.emit("tool.approval.resolved", {
      requestId,
      sessionKey: request.sessionKey,
      toolName: request.toolName,
      approved,
      deviceId: request.deviceId,
    });

    return approved;
  };
}

export async function createDefaultGatewayContext(
  config: YggdrasilConfig,
  sessionStore?: SessionStore | null,
  workspaceRoot?: string,
): Promise<GatewayContext> {
  const globalAgents = await readGlobalAgents();
  const mergedConfig: YggdrasilConfig = {
    ...config,
    agents: mergeAgentSources(config.agents ?? [], globalAgents),
  };
  // Reuses the kernel's own EventBus (the one every plugin's `register(api)`
  // already got as `api.events` — see KernelContext.events' doc comment)
  // when this process went through bootstrapKernel first, which every real
  // gateway (CLI-spawned or app-desktop-spawned) does. Without this, a
  // plugin that emits on `api.events` outside a gateway-method call's own
  // per-request `ctx.events` — e.g. extensions/service-workflows's Scheduler
  // and event triggers, set up once at register(api) time with no `ctx`
  // available — would silently dead-letter: nothing in server.ts forwards
  // from a second, disconnected bus. Falls back to a fresh bus when no
  // kernel was bootstrapped (e.g. a test calling this directly), unchanged
  // from before.
  const events = getKernelContext()?.events ?? createEventBus();
  return {
    config: mergedConfig,
    workspaceRoot,
    events,
    logger: createConsoleLogger("gateway"),
    sessionStore: sessionStore ?? getSessionStore(),
    activeTurns: createActiveTurnTracker(events),
  };
}

function registerBuiltinMethods(): void {
  registerCoreMethod("health", async (_params, ctx) => ({
    ok: true,
    version: "0.5.0",
    pluginApi: CURRENT_PLUGIN_API_VERSION,
    uptime: process.uptime(),
    authRequired: isGatewayAuthRequired(ctx.config),
    // Same value as authRequired, but server.ts's trusted-loopback override
    // (health.authRequired forced to false so the desktop window's own
    // connection doesn't think it needs a key) never touches this one — a
    // probe that is itself loopback-trusted (phoneLinkCore.ts's
    // localGatewayRequiresKey) still needs the real answer.
    keyConfigured: isGatewayAuthRequired(ctx.config),
    ui: true,
    features: ["tool-approval", "parallel-tools", "tracing", "multi-agent"],
  }));

  registerCoreMethod("plugins.list", async () => ({
    plugins: listPlugins().map((p) => ({ id: p.id, name: p.name, version: p.version })),
  }));

  registerCoreMethod("channels.status", async () => ({
    channels: listChannels().map((ch) => ({
      id: ch.id,
      label: ch.meta.label,
      capabilities: ch.capabilities,
    })),
  }));

  registerCoreMethod("channels.start", async (params, ctx) => {
    const channelId = String(params.channelId ?? "");
    const accountId = String(params.accountId ?? "default");
    if (!channelId) {
      throw new Error("channelId required");
    }
    const { ChannelManager } = await import("./channel-manager.js");
    const manager = new ChannelManager({ config: ctx.config });
    await manager.startChannel(channelId, accountId);
    return { started: true, channelId, accountId };
  });

  registerCoreMethod("channels.stop", async (params, ctx) => {
    const channelId = String(params.channelId ?? "");
    const accountId = String(params.accountId ?? "default");
    if (!channelId) {
      throw new Error("channelId required");
    }
    const { ChannelManager } = await import("./channel-manager.js");
    const manager = new ChannelManager({ config: ctx.config });
    await manager.stopChannel(channelId, accountId);
    return { stopped: true, channelId, accountId };
  });

  registerCoreMethod("sessions.list", async (_params, ctx) => {
    const store = ctx.sessionStore;
    if (!store) return { sessions: [] };
    const sessions = await store.list();
    return { sessions };
  });

  registerCoreMethod("sessions.get", async (params, ctx) => {
    const sessionKey = String(params.sessionKey ?? "");
    if (!sessionKey) throw new Error("sessionKey required");
    const store = ctx.sessionStore;
    if (!store) return { session: null };
    const session = await store.get(sessionKey);
    return { session };
  });

  registerCoreMethod("sessions.patch", async (params, ctx) => {
    const sessionKey = String(params.sessionKey ?? "");
    if (!sessionKey) throw new Error("sessionKey required");
    const store = ctx.sessionStore;
    if (!store) throw new Error("session store unavailable");
    const session = await store.patch(sessionKey, {
      title: params.title !== undefined ? String(params.title) : undefined,
      metadata: params.metadata as Record<string, unknown> | undefined,
      agentId: params.agentId !== undefined ? String(params.agentId) : undefined,
    });
    return { session };
  });

  registerCoreMethod("sessions.reset", async (params, ctx) => {
    const sessionKey = String(params.sessionKey ?? "");
    if (!sessionKey) throw new Error("sessionKey required");
    const store = ctx.sessionStore;
    if (store) await store.reset(sessionKey);
    return { reset: true, sessionKey };
  });

  registerCoreMethod("sessions.compact", async (params, ctx) => {
    const sessionKey = String(params.sessionKey ?? "");
    if (!sessionKey) throw new Error("sessionKey required");
    const store = ctx.sessionStore;
    if (!store) return { compacted: false, before: 0, after: 0 };
    const agentId = params.agentId !== undefined ? String(params.agentId) : undefined;
    return compactSessionNow({ sessionKey, store, config: ctx.config, agentId });
  });

  registerCoreMethod("tools.approve", async (params) => {
    const requestId = String(params.requestId ?? "");
    if (!requestId) throw new Error("requestId required");
    const pending = pendingApprovals.get(requestId);
    if (!pending) throw new Error(`No pending approval for requestId: ${requestId}`);
    const approved = params.approved !== false;
    pendingApprovals.delete(requestId);
    pending.resolve(approved);
    return { ok: true, requestId, approved };
  });

  registerCoreMethod("tools.list", async (params, ctx) => {
    // sessionKey selects which connection's device tools (if any) get
    // merged in — see buildDeviceToolDefinitions. Callers that don't care
    // about device tools (or ask before any chat.send has linked a session)
    // just get the server-side tool set, same as before.
    const sessionKey = params.sessionKey !== undefined ? String(params.sessionKey) : "gateway";
    await resolveTools({ sessionKey, config: ctx.config });
    const tools = listTools().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      kind: t.kind,
      riskLevel: t.riskLevel,
    }));
    return { tools };
  });

  registerCoreMethod("device.tools.register", async (params, ctx, connectionId) => {
    if (!connectionId) {
      throw new Error("device.tools.register: no connection context (not a WS request)");
    }
    const rawTools = Array.isArray(params.tools) ? params.tools : [];
    const tools: DeviceToolDecl[] = rawTools.map((raw) => {
      const t = raw as Record<string, unknown>;
      const name = String(t.name ?? "").trim();
      if (!name) throw new Error("device.tools.register: each tool needs a name");
      const kind = t.kind;
      if (kind !== "sync" && kind !== "interactive") {
        throw new Error(`device.tools.register: tool "${name}" must declare kind "sync" or "interactive"`);
      }
      const parameters = (t.parameters as ToolParameterSchema | undefined) ?? {
        type: "object",
        properties: {},
      };
      return { name, description: String(t.description ?? ""), parameters, kind };
    });

    deviceToolsByConnection.set(connectionId, tools);

    const deviceId = typeof params.deviceId === "string" ? params.deviceId.trim() : "";
    if (deviceId) {
      // A device reconnecting with the same id supersedes its old (now-dead)
      // connection — drop the stale reverse-mapping entry so it doesn't
      // linger pointing at a connectionId handleGatewayConnectionClosed
      // already tore down (or will, once the OS notices the old socket died).
      const previousConnectionId = connectionIdByDeviceId.get(deviceId);
      if (previousConnectionId && previousConnectionId !== connectionId) {
        deviceIdByConnectionId.delete(previousConnectionId);
      }
      connectionIdByDeviceId.set(deviceId, connectionId);
      deviceIdByConnectionId.set(connectionId, deviceId);
    }

    if (deviceId && assistantServices) {
      void assistantServices.directory.saveTools(deviceId, tools).catch(() => {});
      setTimeout(() => void drainQueuedForDevice(deviceId, ctx).catch(() => {}), 1500);
    }

    return { ok: true, registered: tools.length };
  });

  // Desktop-admin-only (loopback) — the trust decision itself must come
  // from a human sitting at the desktop app, never from the device being
  // trusted asking for itself. See trustedDevices.ts and
  // isTrustedDeviceConnection above for where this actually takes effect.
  registerCoreMethod("devices.trust.set", async (params, ctx, connectionId) => {
    if (!isLoopbackConnection(connectionId)) {
      throw new Error("devices.trust.set: only callable from the desktop app itself");
    }
    const root = ctx.workspaceRoot;
    if (!root) throw new Error("devices.trust.set: this gateway has no workspaceRoot");
    const deviceId = String(params.deviceId ?? "").trim();
    if (!deviceId) throw new Error("devices.trust.set: deviceId is required");
    await setDeviceTrusted(root, deviceId, params.trusted !== false);
    return { ok: true };
  });

  registerCoreMethod("devices.trust.list", async (_params, ctx, connectionId) => {
    if (!isLoopbackConnection(connectionId)) {
      throw new Error("devices.trust.list: only callable from the desktop app itself");
    }
    const root = ctx.workspaceRoot;
    if (!root) return { devices: [] };
    return { devices: await loadTrustedDevices(root) };
  });

  registerCoreMethod("device.tools.result", async (params) => {
    const requestId = String(params.requestId ?? "");
    if (!requestId) throw new Error("device.tools.result: requestId required");
    const pending = pendingDeviceToolCalls.get(requestId);
    if (!pending) throw new Error(`device.tools.result: no pending device tool call for requestId: ${requestId}`);
    pendingDeviceToolCalls.delete(requestId);
    clearTimeout(pending.timeoutHandle);

    if (params.ok === false) {
      pending.reject(new Error(String(params.error ?? "device tool call failed")));
    } else {
      pending.resolve(params.result);
    }
    return { ok: true, requestId };
  });

  // Optional (v1 non-blocking, section 3.3 of the design doc): lets the
  // phone report "waiting on the user" for an interactive call, and lets a
  // UI client abort one in flight (turn cancelled, approvalMode changed
  // mid-wait). Both are just re-broadcast over the same event bus as
  // device.tool.invoke.requested — server.ts forwards them to every
  // connected client with the standard {type:"event",...} wrapper.
  registerCoreMethod("device.tool.invoke.progress", async (params, ctx) => {
    const requestId = String(params.requestId ?? "");
    if (!requestId) throw new Error("device.tool.invoke.progress: requestId required");
    if (!pendingDeviceToolCalls.has(requestId)) {
      throw new Error(`device.tool.invoke.progress: no pending device tool call for requestId: ${requestId}`);
    }
    await ctx.events.emit("device.tool.invoke.progress", { requestId, status: params.status });
    return { ok: true };
  });

  registerCoreMethod("device.tool.invoke.cancel", async (params, ctx) => {
    const requestId = String(params.requestId ?? "");
    if (!requestId) throw new Error("device.tool.invoke.cancel: requestId required");
    const pending = pendingDeviceToolCalls.get(requestId);
    if (!pending) return { ok: true, requestId, alreadyResolved: true };
    pendingDeviceToolCalls.delete(requestId);
    clearTimeout(pending.timeoutHandle);
    pending.reject(new Error("cancelled"));
    await ctx.events.emit("device.tool.invoke.cancel", { requestId, connectionId: pending.connectionId });
    return { ok: true, requestId };
  });

  registerCoreMethod("tools.approvalMode", async (params) => {
    const sessionKey = String(params.sessionKey ?? "");
    return { sessionKey, mode: getApprovalMode(sessionKey) };
  });

  registerCoreMethod("tools.setApprovalMode", async (params, ctx) => {
    const sessionKey = String(params.sessionKey ?? "");
    if (!sessionKey) throw new Error("tools.setApprovalMode: sessionKey required");
    const mode = params.mode;
    if (mode !== "auto" && mode !== "plan" && mode !== "restrict" && mode !== "yolo") {
      throw new Error('tools.setApprovalMode: mode must be "auto", "plan", "restrict", or "yolo"');
    }
    approvalModes.set(sessionKey, mode);
    await ctx.events.emit("tools.approvalMode.changed", { sessionKey, mode });
    return { sessionKey, mode };
  });

  registerCoreMethod("chat.send", async (params, ctx, connectionId) => {
    const body = String(params.message ?? params.text ?? "");
    const channelId = String(params.channelId ?? "gateway");
    const accountId = String(params.accountId ?? "default");
    const senderId = String(params.senderId ?? "user");
    const sessionKey = String(params.sessionKey ?? buildSessionKey(channelId, accountId, senderId));
    // Links this sessionKey to whichever connection is actually chatting on
    // it — device.tools.register can't know the sessionKey up front (the
    // phone registers immediately on connect, before any chat.send), so this
    // is where the two get joined for buildDeviceToolDefinitions to use.
    if (connectionId) {
      sessionKeyToConnection.set(sessionKey, connectionId);
      // Remember which phone owns this session so its queueable tools can still
      // be offered (and queued) after the app disconnects.
      const ownerDevice = deviceIdByConnectionId.get(connectionId);
      if (ownerDevice) void assistantServices?.directory.linkSession(sessionKey, ownerDevice).catch(() => {});
    }
    const agentId = params.agentId !== undefined ? String(params.agentId) : undefined;
    const provider = params.provider !== undefined ? String(params.provider) : undefined;
    const model = params.model !== undefined ? String(params.model) : undefined;

    const metadata: Record<string, unknown> = {
      ...((params.metadata as Record<string, unknown>) ?? {}),
    };
    if (agentId) metadata.agentId = agentId;
    if (provider) metadata.provider = provider;
    if (model) metadata.model = model;

    const message = ingestInboundMessage({
      channelId,
      accountId,
      sessionKey,
      senderId,
      body,
      metadata,
    });

    const approvalHandler = createGatewayApprovalHandler(ctx.events);

    // One in-flight turn per session: chat.cancel aborts it through this controller.
    const controller = new AbortController();
    turnControllers.set(sessionKey, controller);

    let result: Awaited<ReturnType<typeof runChannelTurn>>;
    try {
      result = await runChannelTurn({
      message,
      config: ctx.config,
      workspaceRoot: ctx.workspaceRoot ?? undefined,
      sessionStore: ctx.sessionStore,
      approveTool: approvalHandler,
      approvalMode: getApprovalMode(sessionKey),
      events: ctx.events,
      signal: controller.signal,
      onDelta: (delta) => {
        void ctx.events.emit("chat.delta", {
          sessionKey,
          text: delta,
          partial: true,
        });
      },
      });
    } finally {
      // A newer turn on the same session may have replaced the entry; only drop our own.
      if (turnControllers.get(sessionKey) === controller) turnControllers.delete(sessionKey);
    }

    pushTurnLog({
      sessionKey: result.sessionKey,
      harnessId: result.harnessId,
      classification: result.admission,
      timestamp: Date.now(),
    });

    await ctx.events.emit("chat.final", {
      sessionKey: result.sessionKey,
      text: result.replyText,
      harnessId: result.harnessId,
      usage: result.usage,
    });

    return {
      sessionKey: result.sessionKey,
      reply: result.replyText,
      harnessId: result.harnessId,
      usage: result.usage,
    };
  });

  registerCoreMethod("chat.cancel", async (params) => {
    const sessionKey = String(params.sessionKey ?? "");
    if (!sessionKey) throw new Error("chat.cancel: sessionKey required");
    const controller = turnControllers.get(sessionKey);
    if (!controller || controller.signal.aborted) return { sessionKey, cancelled: false };
    controller.abort();
    return { sessionKey, cancelled: true };
  });

  registerCoreMethod("turns.recent", async () => ({
    turns: getTurnLogSnapshot(),
  }));

  registerCoreMethod("chat.subscribe", async () => ({
    subscribed: true,
    note: "Subscribe via WebSocket events: chat.final, chat.delta",
  }));

  registerProjectMethods({ register: registerCoreMethod });
  registerTerminalMethods({ register: registerCoreMethod });
  registerAgentMethods({ register: registerCoreMethod });
  registerPhoneMethods({
    getAssistantServices: () => assistantServices,
    deviceIdByConnectionId,
    register: registerCoreMethod,
    getTunnelLookup: () => tunnelAttached,
  });
  registerFsMethods({
    createGatewayApprovalHandler,
    deviceIdByConnectionId,
    isLoopbackConnection,
    isTrustedDeviceConnection,
    register: registerCoreMethod,
  });
  registerConfigMethods({ register: registerCoreMethod });
  registerGitMethods({ register: registerCoreMethod, isLoopbackConnection, isTrustedDeviceConnection });

  setDeviceToolProvider(buildDeviceToolDefinitions);
}

let builtinRegistered = false;

export async function handleGatewayRequest(
  request: GatewayRequest,
  ctx: GatewayContext,
  connectionId?: string,
): Promise<GatewayResponse> {
  if (!builtinRegistered) {
    registerBuiltinMethods();
    builtinRegistered = true;
  }

  const method = request.method?.trim();
  if (!method) {
    return { id: request.id, error: { code: "INVALID_REQUEST", message: "method required" } };
  }

  const params = (request.params ?? {}) as Record<string, unknown>;

  try {
    const pluginHandler = getRegistry().gatewayMethods.get(method);
    if (pluginHandler) {
      const handlerCtx: GatewayHandlerContext = {
        config: ctx.config,
        events: ctx.events,
        logger: ctx.logger,
        connectionId,
      };
      const result = await pluginHandler(params, handlerCtx);
      return { id: request.id, result };
    }

    const core = coreMethods.get(method);
    if (core) {
      const result = await core(params, ctx, connectionId);
      return { id: request.id, result };
    }

    return { id: request.id, error: { code: "METHOD_NOT_FOUND", message: `Unknown method: ${method}` } };
  } catch (err) {
    return {
      id: request.id,
      error: { code: "INTERNAL_ERROR", message: err instanceof Error ? err.message : String(err) },
    };
  }
}
