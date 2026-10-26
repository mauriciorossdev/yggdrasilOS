import type { AgentConfig, YggdrasilConfig } from "@yggdrasil/config";
import { registerGitMethods } from "./git-methods.js";
import { QUEUEABLE_TOOLS, drainDeviceQueue, type QueuedCall } from "./assistant/deviceQueue.js";
import type { AssistantServices } from "./assistant/services.js";
import { deleteAssistantDoc, listAssistantDocs, receiveDocumentChunk } from "./documentUpload.js";
import { isLoopbackAddress } from "./loopbackTrust.js";
import { synthesizeSpeech, TTS_MAX_CHARS } from "./tts.js";
import { isDeviceTrusted, loadTrustedDevices, setDeviceTrusted } from "./trustedDevices.js";
import {
  buildSessionKey,
  createAgent,
  deleteAgent,
  isGatewayAuthRequired,
  mergeAgentSources,
  mergeConfig,
  readConfigFile,
  readGlobalAgents,
  resolveProviderConfig,
  sanitizeConfigForClient,
  updateAgent,
  validateConfigPatch,
  writeConfigFile,
} from "@yggdrasil/config";
import type { ChannelManager } from "./channel-manager.js";
import type { GatewayHandlerContext, GatewayRequest, GatewayResponse, ToolApprovalHandler } from "@yggdrasil/sdk";
import { CURRENT_PLUGIN_API_VERSION } from "@yggdrasil/sdk";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, opendir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  createConsoleLogger,
  createEventBus,
  getKernelContext,
  getProvider,
  getRegistry,
  listChannels,
  listHarnesses,
  listPlugins,
  listProviders,
  listSkillCommands,
} from "@yggdrasil/kernel";
import { ingestInboundMessage, runChannelTurn, compactSessionNow } from "@yggdrasil/pipeline";
import type { SessionStore } from "@yggdrasil/sessions";
import { getSessionStore, SessionStore as SessionStoreClass } from "@yggdrasil/sessions";
import { listTools, resolveTools, setDeviceToolProvider } from "@yggdrasil/tools-runtime";
import type { AgentToolDefinition, ApprovalMode, ToolParameterSchema, ToolRiskLevel } from "@yggdrasil/tools-sdk";
import { pushTurnLog, getTurnLogSnapshot } from "./turn-log.js";
import { loadIgnoreMatcher, toIgnoreTestPath } from "./fs-ignore.js";
import { createActiveTurnTracker, type ActiveTurnTracker } from "./activeTurns.js";
import { stripTerminalChrome } from "./terminalChrome.js";
import { loadDesktopTtsOverrides } from "./desktopTtsOverrides.js";

// Mirrors app-desktop/src/main/projects.ts's ProjectRecord — duplicated
// deliberately (same convention the repo already uses between renderer and
// main) since this package can't import Electron-main-only code.
type ProjectRecord = {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  lastOpenedAt: number;
};

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
// connectionId — used by fs.list/fs.read's loopback exemption below. Same
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

// fs.* gate (remote-access-analysis.md section 5, point 2 — hard prerequisite
// before binding the gateway off loopback). This whole method family was
// reachable by any connected client with zero approval, unlike every other
// mutating/sensitive surface (tools, device-tools) which already goes through
// pendingApprovals. Reuses that exact mechanism — no new pending-map, no new
// event — every fs.* call asks the same tool.approval.requested/tools.approve
// round trip an LLM tool call would.
//
// fs.delete calls this unconditionally, for every connection, no exceptions —
// deleting is irreversible, so it always needs a human's say-so regardless of
// who's asking. It's also the only handler that doesn't even take a
// connectionId param, making it structurally impossible for a future edit to
// accidentally relax it the same way the others below are relaxed.
//
// fs.list/fs.read/fs.readBinary/fs.write/fs.mkdir/fs.rename/git.status/
// git.diff skip this call entirely when isLoopbackConnection(connectionId)
// is true — no UI outside the Chat tab ever answers this approval prompt
// (see FileTree.tsx/FileTreeNode.tsx, FileContentPanel.tsx), so every
// Files/Documents-tab read *or* save/create from the desktop app's own
// loopback connection to its own gateway subprocess was silently timing
// out. A verified-loopback socket is the same machine the human is already
// sitting at; a LAN/Tailscale/phone connection still gets gated exactly as
// before — this doesn't reopen what was closed for remote access, it only
// recognizes that "the app talking to its own subprocess" was never the
// threat model this gate was written for.
//
// Same methods also skip it for isTrustedDeviceConnection — a device
// (phone) the project owner explicitly marked trusted via ApprovalBar.tsx's
// "Confiar en este dispositivo" checkbox or PhoneLinkSection.tsx (see
// trustedDevices.ts). Unlike the loopback case this *is* a remote
// connection, but one the human already vouched for by name, once, same
// posture as a paired device — not a blanket reopening of remote access.
// Deleting stays gated everywhere regardless of connection,
// since undoing a mistaken loopback-trusted delete isn't possible the way
// undoing a bad write/rename/mkdir is.
async function requireFsApproval(
  ctx: GatewayContext,
  method: string,
  params: Record<string, unknown>,
  riskLevel: "moderate" | "destructive",
  connectionId?: string,
): Promise<void> {
  const approve = createGatewayApprovalHandler(ctx.events);
  const approved = await approve({
    sessionKey: String(params.sessionKey ?? ""),
    toolName: method,
    args: params,
    riskLevel,
    deviceId: connectionId ? deviceIdByConnectionId.get(connectionId) : undefined,
  });
  if (!approved) {
    throw new Error(`${method}: denied by user`);
  }
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

  // The desktop app's project registry (app-desktop/src/main/projects.ts)
  // lives in Electron's main process and userData dir, unreachable from this
  // plain Node subprocess — Electron passes us the resolved file path via
  // YGGDRASIL_PROJECTS_FILE at spawn time (see main/gateway.ts) instead.
  registerCoreMethod("projects.list", async () => {
    const projectsFile = process.env.YGGDRASIL_PROJECTS_FILE;
    if (!projectsFile) return { projects: [] };
    let projects: ProjectRecord[];
    try {
      projects = JSON.parse(await readFile(projectsFile, "utf8")) as ProjectRecord[];
    } catch {
      return { projects: [] };
    }

    // Merges in which projects are open right now and on what port
    // (main/openGateways.ts) — lets a mobile client connect straight to the
    // right project's own gateway (for terminals.list) instead of guessing.
    let openGateways: Record<string, { port: number }> = {};
    const openGatewaysFile = process.env.YGGDRASIL_OPEN_GATEWAYS_FILE;
    if (openGatewaysFile) {
      try {
        openGateways = JSON.parse(await readFile(openGatewaysFile, "utf8")) as Record<string, { port: number }>;
      } catch {
        // No registry yet (fresh install) or a transient write race — treat
        // as "nothing open", same as an empty file.
      }
    }

    const enriched = projects.map((p) => {
      const open = openGateways[p.id];
      return { ...p, isOpen: !!open, gatewayPort: open?.port };
    });
    return { projects: enriched.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt) };
  });

  // Creates a project folder on this computer (~/Yggdrasil/<name>) and opens
  // it. The project registry and windows live in Electron's main process, so
  // this bridges to its pane-control server like terminals.* does.
  registerCoreMethod("projects.create", async (params) => {
    const url = process.env.YGGDRASIL_PANE_CONTROL_URL;
    const token = process.env.YGGDRASIL_PANE_CONTROL_TOKEN;
    if (!url || !token) throw new Error("projects.create: only available on a desktop gateway");
    const res = await fetch(`${url}/projects/create`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name: String(params.name ?? "") }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(body.error ?? `projects.create failed (${res.status})`);
    return body;
  });

  // Lets a mobile client compare "which project is this?" against the
  // ProjectRecord it already has from projects.list, to know whether this
  // gateway is the one actually backing that project right now (only that
  // one has live data for terminals.list — every other project's gateway
  // isn't running at all).
  registerCoreMethod("workspace.info", async (_params, ctx) => ({
    workspaceRoot: ctx.workspaceRoot ?? null,
  }));

  // Cross-project session reads — unlike sessions.list/sessions.get (scoped
  // to THIS gateway's own ctx.sessionStore), these take an explicit
  // projectPath and read that project's session files directly off disk via
  // a throwaway SessionStore, bypassing the process-wide getSessionStore()
  // singleton entirely. Works whether or not that project's own gateway is
  // currently running — session files are plain JSON with no live-process
  // dependency (packages/sessions/src/store.ts).
  const PROJECT_SESSION_MAX_MESSAGES = 500;

  registerCoreMethod("projects.sessions.list", async (params) => {
    const projectPath = String(params.projectPath ?? "");
    if (!projectPath) throw new Error("projectPath required");
    const store = new SessionStoreClass(join(projectPath, ".yggdrasil", "sessions"), PROJECT_SESSION_MAX_MESSAGES);
    const sessions = await store.list();
    return { sessions };
  });

  registerCoreMethod("projects.sessions.get", async (params) => {
    const projectPath = String(params.projectPath ?? "");
    const sessionKey = String(params.sessionKey ?? "");
    if (!projectPath) throw new Error("projectPath required");
    if (!sessionKey) throw new Error("sessionKey required");
    const store = new SessionStoreClass(join(projectPath, ".yggdrasil", "sessions"), PROJECT_SESSION_MAX_MESSAGES);
    const session = await store.get(sessionKey);
    return { session };
  });

  // Static Agent Flow config for a project — mirrors app-desktop's
  // readAgentFlow (main/agentFlow.ts), reimplemented here as a direct file
  // read since that module is Electron-main-only (can't be imported from
  // this package). "Is it currently running" is live, in-process state on
  // that project's own gateway — out of scope here, this only returns the
  // saved shape.
  registerCoreMethod("projects.agentFlow.get", async (params) => {
    const projectPath = String(params.projectPath ?? "");
    if (!projectPath) throw new Error("projectPath required");
    try {
      const raw = await readFile(join(projectPath, "agent-flow.json"), "utf8");
      return { agentFlow: JSON.parse(raw) };
    } catch {
      return { agentFlow: null };
    }
  });

  // Agent Teams — named, saved node snapshots (main/agentTeams.ts), a
  // DIFFERENT concept from the single agent-flow.json canvas above (no
  // supervisor, lighter edges) but shown in the same "Agent Flow" screen on
  // desktop (AgentFlowView.tsx's "Open Team ▾"/"Save as Team…") — a project
  // can have real Teams with no saved canvas flow at all, so this needs to
  // be checked separately rather than assumed empty when agentFlow is null.
  registerCoreMethod("projects.agentTeams.list", async (params) => {
    const projectPath = String(params.projectPath ?? "");
    if (!projectPath) throw new Error("projectPath required");
    try {
      const raw = await readFile(join(projectPath, "agent-teams.json"), "utf8");
      const parsed = JSON.parse(raw) as { teams?: unknown[] };
      return { teams: parsed.teams ?? [] };
    } catch {
      return { teams: [] };
    }
  });

  // Bridges into THIS project's pane-control server (main/paneControlServer.ts)
  // — it lives in Electron's main process, not this gateway subprocess, and
  // is loopback-only/token-authed, so its URL+token are handed across via
  // env at spawn time (see main/gateway.ts's spawnGatewaySubprocess). Only
  // ever reflects the project this gateway itself is scoped to — there is no
  // cross-project bridge for live terminal state, unlike sessions/agentFlow
  // above.
  registerCoreMethod("terminals.list", async (_params, ctx) => {
    const url = process.env.YGGDRASIL_PANE_CONTROL_URL;
    const token = process.env.YGGDRASIL_PANE_CONTROL_TOKEN;
    if (!url || !token) return { panes: [], available: false };

    type RawPane = { id: string; title: string; cwd: string; createdAt: number; sessionKey?: string };
    let panes: RawPane[];
    try {
      const res = await fetch(`${url}/panes`, { headers: { authorization: `Bearer ${token}` } });
      const body = (await res.json()) as { panes?: RawPane[] };
      panes = body.panes ?? [];
    } catch {
      return { panes: [], available: false };
    }

    return {
      available: true,
      panes: panes.map((p) => ({
        ...p,
        working: p.sessionKey ? ctx.activeTurns.isActive(p.sessionKey) : false,
      })),
    };
  });

  // Same pane-control bridge as terminals.list — plain-text (ANSI-stripped)
  // tail of one pane's recent output, per paneControlServer.ts's GET
  // /panes/:id/read (main/terminals.ts's readTerminalOutput). A redrawing
  // TUI (claude's own interactive UI) will look repetitive/noisy here rather
  // than resolving to its final state — accepted tradeoff, same one
  // terminals.ts's own stripAnsi comment documents for this read path.
  registerCoreMethod("terminals.read", async (params) => {
    const url = process.env.YGGDRASIL_PANE_CONTROL_URL;
    const token = process.env.YGGDRASIL_PANE_CONTROL_TOKEN;
    if (!url || !token) return { text: "", available: false };
    const id = String(params.id ?? "");
    if (!id) throw new Error("id required");
    const maxChars = Number(params.maxChars ?? 4000) || 4000;
    // Optional — a mobile client's own screen width, so long lines reflow to
    // it instead of whatever the desktop pane's actual pty columns are right
    // now (see terminals.ts's mobileTerm mirror — never resizes the real pty).
    const cols = params.cols != null ? Number(params.cols) : undefined;
    const query = cols && Number.isFinite(cols) && cols > 0 ? `&cols=${cols}` : "";
    try {
      const res = await fetch(`${url}/panes/${encodeURIComponent(id)}/read?maxChars=${maxChars}${query}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) return { text: "", available: false };
      const body = (await res.json()) as { text?: string };
      return { text: stripTerminalChrome(body.text ?? ""), available: true };
    } catch {
      return { text: "", available: false };
    }
  });

  // Same pane-control bridge as terminals.read, but structured instead of
  // raw text — proxies paneControlServer.ts's GET /panes/:id/transcript,
  // which parses Claude Code's own JSONL transcript (main/claudeTranscript.ts)
  // for a `claude` pane spawned with a minted --session-id. `available: false`
  // means either this isn't a `claude` pane or its transcript path couldn't
  // be resolved — the mobile client falls back to terminals.read in that case.
  registerCoreMethod("terminals.transcript", async (params) => {
    const url = process.env.YGGDRASIL_PANE_CONTROL_URL;
    const token = process.env.YGGDRASIL_PANE_CONTROL_TOKEN;
    if (!url || !token) return { available: false, messages: [] };
    const id = String(params.id ?? "");
    if (!id) throw new Error("id required");
    try {
      const res = await fetch(`${url}/panes/${encodeURIComponent(id)}/transcript`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) return { available: false, messages: [] };
      return (await res.json()) as { available: boolean; messages: unknown[] };
    } catch {
      return { available: false, messages: [] };
    }
  });

  const SUMMARIZE_TIMEOUT_MS = 10_000;

  // Summarizes a `claude` pane's last assistant reply into a few spoken
  // sentences and synthesizes it (Replicate TTS, see tts.ts) — the desktop
  // terminal pane's "speak last response" button. Reuses terminals.transcript's
  // own pane-control bridge to find the text (never screen-scrapes the pane's
  // raw ANSI/TUI output, which can't recover long/truncated/markdown-rendered
  // replies cleanly) and automation.author's one-shot chatComplete pattern to
  // summarize — fully independent of whatever provider the pane's own `claude`
  // CLI process is authenticated with, this rides the gateway's own default
  // agent config instead.
  registerCoreMethod("terminals.speak", async (params, ctx) => {
    const overrides = await loadDesktopTtsOverrides();
    if (!overrides.enabled) throw new Error("TTS deshabilitado en Settings → Voz de este equipo");
    const url = process.env.YGGDRASIL_PANE_CONTROL_URL;
    const token = process.env.YGGDRASIL_PANE_CONTROL_TOKEN;
    if (!url || !token) throw new Error("terminals.speak: pane control not available");
    const id = String(params.id ?? "");
    if (!id) throw new Error("id required");
    const callerVoiceId = params.voiceId !== undefined ? String(params.voiceId) : undefined;
    const voiceId = callerVoiceId || overrides.voiceId;

    let messages: { kind?: string; text?: string }[];
    try {
      const res = await fetch(`${url}/panes/${encodeURIComponent(id)}/transcript`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const body = (await res.json()) as { available?: boolean; messages?: { kind?: string; text?: string }[] };
      if (!res.ok || !body.available) throw new Error("no hay transcript disponible para este pane");
      messages = body.messages ?? [];
    } catch (err) {
      if (err instanceof Error && err.message.includes("transcript")) throw err;
      throw new Error("terminals.speak: no se pudo leer el pane");
    }

    const lastReply = [...messages].reverse().find((m) => m.kind === "assistant_text")?.text?.trim();
    if (!lastReply) throw new Error("no hay una respuesta de claude para leer en este pane");

    // "full" (user picked "Todo" in the pane's speak-button menu) skips the
    // local agent entirely — speaks the raw reply as-is (clipped below).
    const mode = params.mode === "full" ? "full" : "summary";
    let summary = lastReply;
    if (mode === "summary") {
      // Best-effort — a broken/misconfigured default agent (wrong provider,
      // expired key, unreachable local model) must never block "hablar
      // última respuesta" entirely: fall back to speaking the raw reply
      // (clipped to TTS_MAX_CHARS) instead of hard-failing the whole RPC.
      // Logged with the actually-resolved agent/provider id so a
      // misconfiguration is visible in the gateway's own stdout instead of
      // only surfacing as an opaque provider error.
      try {
        const agent = (ctx.config.agents ?? []).find((a) => a.id === ctx.config.defaultAgent);
        if (!agent?.provider || !agent.model) {
          throw new Error(`default agent "${ctx.config.defaultAgent}" has no provider/model`);
        }
        const provider = getProvider(agent.provider);
        if (!provider?.chatComplete) {
          throw new Error(`provider "${agent.provider}" (agent "${agent.id}") cannot chat`);
        }
        const providerCfg = resolveProviderConfig(ctx.config, agent.provider);
        // Bounded — an unreachable local model (e.g. Ollama not running) can
        // hang a plain fetch() indefinitely with no error at all, which would
        // otherwise block this whole RPC until the CLIENT's own timeout fires
        // (useGateway's call() waits up to 60s) instead of degrading
        // gracefully like the error-throwing failure modes above already do.
        const result = await Promise.race([
          provider.chatComplete(
            { config: providerCfg },
            {
              model: agent.model,
              messages: [
                {
                  role: "system",
                  content:
                    "Resume el siguiente texto en 2-3 oraciones breves, en español, sin markdown ni bloques de código, " +
                    "como para ser leído en voz alta.",
                },
                { role: "user", content: lastReply },
              ],
              temperature: 0.2,
            },
          ),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`summarize timed out after ${SUMMARIZE_TIMEOUT_MS}ms`)),
              SUMMARIZE_TIMEOUT_MS,
            ),
          ),
        ]);
        if (result.text.trim()) summary = result.text.trim();
      } catch (err) {
        console.error(
          `terminals.speak: summarization failed (agent "${ctx.config.defaultAgent}"), speaking raw reply instead —`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    if (summary.length > TTS_MAX_CHARS) summary = `${summary.slice(0, TTS_MAX_CHARS - 1)}…`;

    const { audioBase64, mimeType } = await synthesizeSpeech({
      text: summary,
      voiceId,
      env: overrides.apiToken ? { ...process.env, REPLICATE_API_TOKEN: overrides.apiToken } : undefined,
    });
    return { text: summary, audioBase64, mimeType };
  });

  // Sends input into one pane — same write+delayed-Enter mechanism as the
  // desktop's own Delegate/write_pane flows (paneControlServer.ts's POST
  // /panes/:id/write), so a burst of text reads as a genuine submit, not a
  // paste, to whatever's running in that pane.
  registerCoreMethod("terminals.write", async (params) => {
    const url = process.env.YGGDRASIL_PANE_CONTROL_URL;
    const token = process.env.YGGDRASIL_PANE_CONTROL_TOKEN;
    if (!url || !token) return { ok: false };
    const id = String(params.id ?? "");
    const text = String(params.text ?? "");
    if (!id) throw new Error("id required");
    try {
      const res = await fetch(`${url}/panes/${encodeURIComponent(id)}/write`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ text, pressEnter: params.pressEnter !== false }),
      });
      return { ok: res.ok };
    } catch {
      return { ok: false };
    }
  });

  // Widens the REAL pty so a TUI (Ink-based `claude` panes) re-renders its
  // own output at a phone-readable width instead of whatever narrow size the
  // desktop pane happens to be — reflow via terminals.read's `cols` alone
  // can't fix this since Ink hard-wraps based on the actual pty size it's
  // told, not a soft xterm-level wrap. Real side effect: the desktop pane's
  // own on-screen content reflows too while a phone has it expanded (main/
  // terminals.ts's expandTerminalForMobile) — same tradeoff any terminal
  // multiplexer has. Always pair with terminals.restore when the mobile
  // screen is closed.
  registerCoreMethod("terminals.expand", async (params) => {
    const url = process.env.YGGDRASIL_PANE_CONTROL_URL;
    const token = process.env.YGGDRASIL_PANE_CONTROL_TOKEN;
    if (!url || !token) return { ok: false };
    const id = String(params.id ?? "");
    if (!id) throw new Error("id required");
    try {
      const res = await fetch(`${url}/panes/${encodeURIComponent(id)}/expand`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ cols: params.cols, rows: params.rows }),
      });
      return { ok: res.ok };
    } catch {
      return { ok: false };
    }
  });

  registerCoreMethod("terminals.restore", async (params) => {
    const url = process.env.YGGDRASIL_PANE_CONTROL_URL;
    const token = process.env.YGGDRASIL_PANE_CONTROL_TOKEN;
    if (!url || !token) return { ok: false };
    const id = String(params.id ?? "");
    if (!id) throw new Error("id required");
    try {
      const res = await fetch(`${url}/panes/${encodeURIComponent(id)}/restore`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      return { ok: res.ok };
    } catch {
      return { ok: false };
    }
  });

  registerCoreMethod("skills.commands", async () => ({
    commands: listSkillCommands(),
  }));

  registerCoreMethod("agents.list", async (_params, ctx) => {
    const projectAgents = ctx.workspaceRoot
      ? ((await readConfigFile(ctx.workspaceRoot)).config.agents ?? [])
      : (ctx.config.agents ?? []);
    const globalAgents = await readGlobalAgents();
    const merged = mergeAgentSources(projectAgents, globalAgents);
    return {
      agents: merged.map((a) => ({
        ...a,
        systemPrompt: a.systemPrompt ? a.systemPrompt.slice(0, 200) : undefined,
      })),
      defaultAgent: ctx.config.defaultAgent,
    };
  });

  registerCoreMethod("agents.create", async (params, ctx) => {
    const id = String(params.id ?? "").trim();
    if (!id) throw new Error("agents.create: id is required");
    const scope = params.scope;
    if (scope !== "local" && scope !== "global") {
      throw new Error(`agents.create: scope must be "local" or "global", got ${JSON.stringify(scope)}`);
    }
    const agent: AgentConfig = {
      id,
      label: params.label !== undefined ? String(params.label) : undefined,
      provider: params.provider !== undefined ? String(params.provider) : undefined,
      model: params.model !== undefined ? String(params.model) : undefined,
      harness: params.harness !== undefined ? String(params.harness) : undefined,
      systemPrompt: params.systemPrompt !== undefined ? String(params.systemPrompt) : undefined,
      contextProviders: Array.isArray(params.contextProviders)
        ? (params.contextProviders as string[])
        : undefined,
    };

    const created = await createAgent({ agent, scope, workspaceRoot: ctx.workspaceRoot });

    // Refresh in-memory ctx.config.agents so the new agent is immediately usable
    // in this gateway process without a restart (mirrors config.patch's eager update).
    const globalAgents = await readGlobalAgents();
    const projectAgents = ctx.workspaceRoot
      ? ((await readConfigFile(ctx.workspaceRoot)).config.agents ?? [])
      : (ctx.config.agents ?? []);
    ctx.config.agents = mergeAgentSources(projectAgents, globalAgents);

    return { ok: true, agent: created };
  });

  // Full, untruncated agent config for editing — agents.list truncates
  // systemPrompt to 200 chars for display-only contexts (chat/agent
  // pickers), which would silently clip a long system prompt if reused to
  // pre-fill an edit form.
  registerCoreMethod("agents.get", async (params, ctx) => {
    const id = String(params.id ?? "").trim();
    if (!id) throw new Error("agents.get: id is required");
    const scope = params.scope;
    if (scope !== "local" && scope !== "global") {
      throw new Error(`agents.get: scope must be "local" or "global", got ${JSON.stringify(scope)}`);
    }
    const source =
      scope === "local"
        ? (ctx.workspaceRoot ? (await readConfigFile(ctx.workspaceRoot)).config.agents : ctx.config.agents) ?? []
        : await readGlobalAgents();
    const agent = source.find((a) => a.id === id);
    if (!agent) throw new Error(`agents.get: agent "${id}" not found in ${scope} scope`);
    return { agent: { ...agent, scope } };
  });

  registerCoreMethod("agents.update", async (params, ctx) => {
    const id = String(params.id ?? "").trim();
    if (!id) throw new Error("agents.update: id is required");
    const scope = params.scope;
    if (scope !== "local" && scope !== "global") {
      throw new Error(`agents.update: scope must be "local" or "global", got ${JSON.stringify(scope)}`);
    }
    const agent: AgentConfig = {
      id,
      label: params.label !== undefined ? String(params.label) : undefined,
      provider: params.provider !== undefined ? String(params.provider) : undefined,
      model: params.model !== undefined ? String(params.model) : undefined,
      harness: params.harness !== undefined ? String(params.harness) : undefined,
      systemPrompt: params.systemPrompt !== undefined ? String(params.systemPrompt) : undefined,
      contextProviders: Array.isArray(params.contextProviders)
        ? (params.contextProviders as string[])
        : undefined,
    };

    const updated = await updateAgent({ agent, scope, workspaceRoot: ctx.workspaceRoot });

    const globalAgents = await readGlobalAgents();
    const projectAgents = ctx.workspaceRoot
      ? ((await readConfigFile(ctx.workspaceRoot)).config.agents ?? [])
      : (ctx.config.agents ?? []);
    ctx.config.agents = mergeAgentSources(projectAgents, globalAgents);

    return { ok: true, agent: updated };
  });

  registerCoreMethod("agents.delete", async (params, ctx) => {
    const id = String(params.id ?? "").trim();
    if (!id) throw new Error("agents.delete: id is required");
    const scope = params.scope;
    if (scope !== "local" && scope !== "global") {
      throw new Error(`agents.delete: scope must be "local" or "global", got ${JSON.stringify(scope)}`);
    }

    await deleteAgent({ id, scope, workspaceRoot: ctx.workspaceRoot });

    // Refresh in-memory ctx.config.agents so the removal is immediately
    // reflected without a restart — mirrors agents.create/agents.update.
    const globalAgents = await readGlobalAgents();
    const projectAgents = ctx.workspaceRoot
      ? ((await readConfigFile(ctx.workspaceRoot)).config.agents ?? [])
      : (ctx.config.agents ?? []);
    ctx.config.agents = mergeAgentSources(projectAgents, globalAgents);

    return { ok: true };
  });

  registerCoreMethod("harnesses.list", async () => ({
    harnesses: listHarnesses().map(({ harness }) => ({
      id: harness.id,
      label: harness.label,
      pluginId: harness.pluginId,
    })),
  }));

  registerCoreMethod("providers.list", async (_params, ctx) => {
    const providers = listProviders();
    // Each provider is resolved independently — one unreachable host (a dead
    // LAN IP, a provider down) must not take out the whole response. Before
    // this, a single rejected listModels() call failed the entire
    // Promise.all, which meant Settings couldn't load *at all* just because
    // one configured provider's URL was down.
    const models = await Promise.all(
      providers.map(async (p) => {
        try {
          return {
            id: p.id,
            label: p.label,
            models: await p.listModels({ config: resolveProviderConfig(ctx.config, p.id) }),
          };
        } catch (err) {
          return {
            id: p.id,
            label: p.label,
            models: [],
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );
    return { providers: models };
  });

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

  // --- desktop directory (phone discovery of desktop gateways) ---
  // A desktop publishes {name, projects+ports, LAN/Tailscale host, gateway key}
  // here on launch and every minute; the phone lists them so nobody types an IP,
  // a port that changes every launch, or a key. Same API key as everything else.
  registerCoreMethod("desktops.register", async (params) => {
    const services = assistantServices;
    if (!services) throw new Error("desktops: not available on this gateway");
    const view = await services.desktops.register(params);
    return { ok: true, desktopId: view.desktopId, online: view.online };
  });

  registerCoreMethod("desktops.list", async () => {
    const services = assistantServices;
    if (!services) throw new Error("desktops: not available on this gateway");
    return { desktops: services.desktops.list().map((d) => ({ ...d, tunnel: tunnelAttached?.(d.desktopId) ?? false })) };
  });

  registerCoreMethod("desktops.offline", async (params) => {
    const services = assistantServices;
    if (!services) throw new Error("desktops: not available on this gateway");
    return { ok: await services.desktops.goOffline(String(params.desktopId ?? "")) };
  });

  registerCoreMethod("desktops.remove", async (params) => {
    const services = assistantServices;
    if (!services) throw new Error("desktops: not available on this gateway");
    return { ok: await services.desktops.remove(String(params.desktopId ?? "")) };
  });

  // --- push (FCM) ---
  registerCoreMethod("push.register", async (params, _ctx, connectionId) => {
    const services = assistantServices;
    if (!services) throw new Error("push is not available on this gateway");
    const token = String(params.token ?? "").trim();
    // The stable id the phone registered its tools with; fall back to a param for tests/CLI.
    const deviceId =
      (connectionId ? deviceIdByConnectionId.get(connectionId) : undefined) ?? String(params.deviceId ?? "").trim();
    if (!token) throw new Error("token required");
    if (!deviceId) throw new Error("push.register: register device tools first (no deviceId for this connection)");
    await services.push.register(deviceId, token);
    return { ok: true, configured: services.push.configured };
  });

  registerCoreMethod("push.unregister", async (params, _ctx, connectionId) => {
    const services = assistantServices;
    if (!services) throw new Error("push is not available on this gateway");
    const deviceId =
      (connectionId ? deviceIdByConnectionId.get(connectionId) : undefined) ?? String(params.deviceId ?? "").trim();
    return { ok: deviceId ? await services.push.unregister(deviceId) : false };
  });

  registerCoreMethod("push.status", async () => ({
    available: assistantServices !== null,
    configured: assistantServices?.push.configured ?? false,
    devices: assistantServices?.push.deviceCount() ?? 0,
    pendingReminders: assistantServices?.reminders.pending().length ?? 0,
    queued: assistantServices?.queue.list().length ?? 0,
  }));

  registerCoreMethod("push.test", async (params) => {
    const services = assistantServices;
    if (!services) throw new Error("push is not available on this gateway");
    return services.push.notify({
      title: String(params.title ?? "Yggdrasil"),
      body: String(params.body ?? "Notificación de prueba"),
      data: { type: "test" },
    });
  });

  // Phone -> assistant document uploads (chunked base64). Files land in the
  // project's notes/assistant/ folder, where the assistant's read_document
  // tool can read them; the returned path is relative to notes/.
  registerCoreMethod("documents.upload", async (params, ctx) => {
    if (!ctx.workspaceRoot) throw new Error("documents.upload: no workspace configured");
    return receiveDocumentChunk({
      workspaceRoot: ctx.workspaceRoot,
      uploadId: String(params.uploadId ?? ""),
      name: String(params.name ?? ""),
      index: Number(params.index ?? 0),
      data: String(params.data ?? ""),
      final: params.final === true,
    });
  });

  registerCoreMethod("documents.list", async (_params, ctx) => {
    if (!ctx.workspaceRoot) throw new Error("documents.list: no workspace configured");
    return { documents: await listAssistantDocs(ctx.workspaceRoot) };
  });

  registerCoreMethod("documents.delete", async (params, ctx) => {
    if (!ctx.workspaceRoot) throw new Error("documents.delete: no workspace configured");
    return { ok: await deleteAssistantDoc(ctx.workspaceRoot, String(params.name ?? "")) };
  });

  // Text-to-speech for clients (the phone's assistant chat). Returns the whole
  // clip as base64 mp3; the Replicate token never leaves the gateway.
  registerCoreMethod("tts.synthesize", async (params) => {
    const overrides = await loadDesktopTtsOverrides();
    if (!overrides.enabled) throw new Error("TTS deshabilitado en Settings → Voz de este equipo");
    const callerVoiceId = params.voiceId !== undefined ? String(params.voiceId) : undefined;
    return synthesizeSpeech({
      text: String(params.text ?? ""),
      voiceId: callerVoiceId || overrides.voiceId,
      env: overrides.apiToken ? { ...process.env, REPLICATE_API_TOKEN: overrides.apiToken } : undefined,
    });
  });

  registerCoreMethod("sessions.compact", async (params, ctx) => {
    const sessionKey = String(params.sessionKey ?? "");
    if (!sessionKey) throw new Error("sessionKey required");
    const store = ctx.sessionStore;
    if (!store) return { compacted: false, before: 0, after: 0 };
    const agentId = params.agentId !== undefined ? String(params.agentId) : undefined;
    return compactSessionNow({ sessionKey, store, config: ctx.config, agentId });
  });

  // Every fs.* method below also goes through requireFsApproval (see above)
  // before touching disk — closed the historical gap where this whole family
  // was reachable by any connected client with zero approval gate, unlike
  // tool-system's fs tools. Independent of that: every method here must still
  // resolve relativePath through this guard, so a crafted "../../etc/passwd"
  // (or an absolute/different-drive path) can never escape the project root
  // even once approved.
  function resolveWithinRoot(root: string, methodName: string, relativePath: string): string {
    const resolvedRoot = resolve(root);
    const target = resolve(resolvedRoot, relativePath);
    const rel = relative(resolvedRoot, target);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`${methodName}: relativePath escapes the project root`);
    }
    return target;
  }

  const FS_LIST_MAX_ENTRIES = 2000;

  registerCoreMethod("fs.list", async (params, ctx, connectionId) => {
    if (!isLoopbackConnection(connectionId) && !(await isTrustedDeviceConnection(ctx.workspaceRoot, connectionId))) {
      await requireFsApproval(ctx, "fs.list", params, "moderate", connectionId);
    }
    const root = ctx.workspaceRoot;
    if (!root) throw new Error("fs.list: this gateway has no workspaceRoot");

    const relativePath = params.relativePath !== undefined ? String(params.relativePath) : "";
    const target = resolveWithinRoot(root, "fs.list", relativePath);

    const ig = await loadIgnoreMatcher(root);

    // opendir()'s async iterator, not readdir(), so a pathological directory
    // (node_modules with 100k+ entries, a cloud-synced folder where each
    // dirent is a slow network round-trip) can be capped by stopping at
    // FS_LIST_MAX_ENTRIES instead of always materializing the whole
    // directory first — that unbounded materialization was the actual
    // "Timeout: fs.list" cause, not the 2000-entry response cap below it.
    const typed: { name: string; type: "directory" | "file" | "other" }[] = [];
    let truncated = false;
    const dir = await opendir(target);
    try {
      for await (const e of dir) {
        if (ig.ignores(toIgnoreTestPath(root, join(target, e.name)))) continue;
        if (typed.length >= FS_LIST_MAX_ENTRIES) {
          truncated = true;
          break;
        }
        typed.push({
          name: e.name,
          type: e.isDirectory() ? "directory" : e.isFile() ? "file" : "other",
        });
      }
    } finally {
      await dir.close().catch(() => undefined);
    }
    typed.sort((a, b) => (a.type !== b.type ? (a.type === "directory" ? -1 : 1) : a.name.localeCompare(b.name)));

    return { path: relativePath, entries: typed, truncated };
  });

  // A single RPC response over a local/loopback connection — 50k chars was
  // needlessly tight for this (notes/*.md routinely run past it; compare
  // fs.readBinary's 20MB cap just below, for the same kind of response).
  // Raised, not removed: fs.write is still fully unbounded (see its own
  // comment) but a read should stay bounded against something truly
  // pathological (an accidentally-opened multi-GB log).
  const FS_READ_MAX_CHARS = 2_000_000;

  registerCoreMethod("fs.read", async (params, ctx, connectionId) => {
    if (!isLoopbackConnection(connectionId) && !(await isTrustedDeviceConnection(ctx.workspaceRoot, connectionId))) {
      await requireFsApproval(ctx, "fs.read", params, "moderate", connectionId);
    }
    const root = ctx.workspaceRoot;
    if (!root) throw new Error("fs.read: this gateway has no workspaceRoot");

    const relativePath = String(params.relativePath ?? "");
    if (!relativePath) throw new Error("fs.read: relativePath is required");
    const target = resolveWithinRoot(root, "fs.read", relativePath);

    const content = await readFile(target, "utf8");
    if (content.length > FS_READ_MAX_CHARS) {
      return {
        path: relativePath,
        content: content.slice(0, FS_READ_MAX_CHARS),
        truncated: true,
        totalLength: content.length,
      };
    }
    return { path: relativePath, content, truncated: false };
  });

  // Base64 round-trip for binary previews (images, PDFs — see
  // renderer/src/files/FileViewer.tsx) that fs.read can't handle: reading a
  // binary file as "utf8" (fs.read's encoding) corrupts it. Base64 inflates
  // size ~33%, so the cap here is generous but still bounded — this is a
  // single RPC response, not a stream.
  const FS_READ_BINARY_MAX_BYTES = 20_000_000;

  registerCoreMethod("fs.readBinary", async (params, ctx, connectionId) => {
    // Same loopback exemption as fs.read/fs.list just above — this is the
    // desktop app's own Documents panel viewing an image/PDF from its own
    // project, not a remote/agent action; it was missing here even though
    // every other plain-read fs.* method already has it, which is why
    // opening a preview always prompted for approval.
    if (!isLoopbackConnection(connectionId) && !(await isTrustedDeviceConnection(ctx.workspaceRoot, connectionId))) {
      await requireFsApproval(ctx, "fs.readBinary", params, "moderate", connectionId);
    }
    const root = ctx.workspaceRoot;
    if (!root) throw new Error("fs.readBinary: this gateway has no workspaceRoot");

    const relativePath = String(params.relativePath ?? "");
    if (!relativePath) throw new Error("fs.readBinary: relativePath is required");
    const target = resolveWithinRoot(root, "fs.readBinary", relativePath);

    const buf = await readFile(target);
    if (buf.length > FS_READ_BINARY_MAX_BYTES) {
      return { path: relativePath, base64: "", truncated: true, totalBytes: buf.length };
    }
    return { path: relativePath, base64: buf.toString("base64"), truncated: false, totalBytes: buf.length };
  });

  // Extensions with no sensible plain-text representation to hand an LLM —
  // fs.readDocumentText rejects these with a clear message instead of
  // dumping raw/garbled bytes as "content" (what naively utf8-decoding them
  // would produce).
  const FS_DOCUMENT_TEXT_UNSUPPORTED_EXTS = new Set([
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
    "bmp",
    "ico",
    "mp3",
    "mp4",
    "mov",
    "wav",
    "zip",
    "tar",
    "gz",
    "exe",
    "dmg",
    "sqlite",
    "sqlite3",
  ]);
  const FS_DOCUMENT_TEXT_MAX_CHARS = 50_000;

  // Chat-attachment resolution (ChatView.tsx's resolveAttachments) — unlike
  // fs.read (raw utf8, used by the code editor, must round-trip exactly),
  // this extracts whatever plain text is reasonably available so a PDF (or
  // future format) can be sent as context, not just already-text files.
  registerCoreMethod("fs.readDocumentText", async (params, ctx) => {
    await requireFsApproval(ctx, "fs.readDocumentText", params, "moderate");
    const root = ctx.workspaceRoot;
    if (!root) throw new Error("fs.readDocumentText: this gateway has no workspaceRoot");

    const relativePath = String(params.relativePath ?? "");
    if (!relativePath) throw new Error("fs.readDocumentText: relativePath is required");
    const target = resolveWithinRoot(root, "fs.readDocumentText", relativePath);
    const ext = relativePath.slice(relativePath.lastIndexOf(".") + 1).toLowerCase();

    let content: string;
    if (ext === "pdf") {
      const bytes = await readFile(target);
      const { extractPdfText } = await import("./documentText.js");
      content = await extractPdfText(bytes);
    } else if (FS_DOCUMENT_TEXT_UNSUPPORTED_EXTS.has(ext)) {
      throw new Error(`fs.readDocumentText: no text representation for .${ext} files`);
    } else {
      content = await readFile(target, "utf8");
    }

    if (content.length > FS_DOCUMENT_TEXT_MAX_CHARS) {
      return {
        path: relativePath,
        content: content.slice(0, FS_DOCUMENT_TEXT_MAX_CHARS),
        truncated: true,
        totalLength: content.length,
      };
    }
    return { path: relativePath, content, truncated: false };
  });

  // No size cap here unlike fs.read's FS_READ_MAX_CHARS — that cap exists to
  // bound a single RPC response; a write's size is entirely caller-supplied
  // and controlled (the editor UI that calls this already has the file open).
  registerCoreMethod("fs.write", async (params, ctx, connectionId) => {
    if (!isLoopbackConnection(connectionId) && !(await isTrustedDeviceConnection(ctx.workspaceRoot, connectionId))) {
      await requireFsApproval(ctx, "fs.write", params, "destructive", connectionId);
    }
    const root = ctx.workspaceRoot;
    if (!root) throw new Error("fs.write: this gateway has no workspaceRoot");

    const relativePath = String(params.relativePath ?? "");
    if (!relativePath) throw new Error("fs.write: relativePath is required");
    const content = params.content !== undefined ? String(params.content) : "";
    const target = resolveWithinRoot(root, "fs.write", relativePath);

    // Creates parent dirs too, so this doubles as "create file" for a brand
    // new path (including one nested under folders that don't exist yet).
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
    return { ok: true, path: relativePath };
  });

  registerCoreMethod("fs.mkdir", async (params, ctx, connectionId) => {
    if (!isLoopbackConnection(connectionId) && !(await isTrustedDeviceConnection(ctx.workspaceRoot, connectionId))) {
      await requireFsApproval(ctx, "fs.mkdir", params, "destructive", connectionId);
    }
    const root = ctx.workspaceRoot;
    if (!root) throw new Error("fs.mkdir: this gateway has no workspaceRoot");

    const relativePath = String(params.relativePath ?? "");
    if (!relativePath) throw new Error("fs.mkdir: relativePath is required");
    const target = resolveWithinRoot(root, "fs.mkdir", relativePath);

    await mkdir(target, { recursive: true });
    return { ok: true, path: relativePath };
  });

  registerCoreMethod("fs.rename", async (params, ctx, connectionId) => {
    if (!isLoopbackConnection(connectionId) && !(await isTrustedDeviceConnection(ctx.workspaceRoot, connectionId))) {
      await requireFsApproval(ctx, "fs.rename", params, "destructive", connectionId);
    }
    const root = ctx.workspaceRoot;
    if (!root) throw new Error("fs.rename: this gateway has no workspaceRoot");

    const fromRelativePath = String(params.fromRelativePath ?? "");
    const toRelativePath = String(params.toRelativePath ?? "");
    if (!fromRelativePath || !toRelativePath) {
      throw new Error("fs.rename: fromRelativePath and toRelativePath are required");
    }
    const from = resolveWithinRoot(root, "fs.rename", fromRelativePath);
    const to = resolveWithinRoot(root, "fs.rename", toRelativePath);

    await mkdir(dirname(to), { recursive: true });
    await rename(from, to);
    return { ok: true, path: toRelativePath };
  });

  registerCoreMethod("fs.delete", async (params, ctx) => {
    await requireFsApproval(ctx, "fs.delete", params, "destructive");
    const root = ctx.workspaceRoot;
    if (!root) throw new Error("fs.delete: this gateway has no workspaceRoot");

    const relativePath = String(params.relativePath ?? "");
    if (!relativePath) throw new Error("fs.delete: relativePath is required");
    const target = resolveWithinRoot(root, "fs.delete", relativePath);

    // recursive:true so this also handles directories in one call (the
    // renderer must window.confirm before calling this — see FileTreeContextMenu).
    await rm(target, { recursive: true, force: false });
    return { ok: true, path: relativePath };
  });

  const FS_SEARCH_SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".yggdrasil"]);
  const FS_SEARCH_MAX_ENTRIES_SCANNED = 5000;
  const FS_SEARCH_DEFAULT_LIMIT = 50;

  registerCoreMethod("fs.search", async (params, ctx) => {
    const root = ctx.workspaceRoot;
    if (!root) throw new Error("fs.search: this gateway has no workspaceRoot");

    const query = String(params.query ?? "").toLowerCase();
    const limit = params.limit !== undefined ? Number(params.limit) : FS_SEARCH_DEFAULT_LIMIT;
    const resolvedRoot = resolve(root);

    const results: Array<{ relativePath: string; type: "file" | "directory" }> = [];
    let scanned = 0;

    async function walk(dir: string): Promise<void> {
      if (results.length >= limit || scanned >= FS_SEARCH_MAX_ENTRIES_SCANNED) return;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (results.length >= limit || scanned >= FS_SEARCH_MAX_ENTRIES_SCANNED) return;
        scanned++;
        if (FS_SEARCH_SKIP_DIRS.has(entry.name)) continue;

        const abs = join(dir, entry.name);
        const rel = relative(resolvedRoot, abs).split(sep).join("/");
        const type: "file" | "directory" = entry.isDirectory() ? "directory" : "file";

        if (!query || rel.toLowerCase().includes(query)) {
          results.push({ relativePath: rel, type });
        }
        if (entry.isDirectory()) {
          await walk(abs);
        }
      }
    }

    await walk(resolvedRoot);
    return { entries: results.slice(0, limit) };
  });

  type GitFileStatus = "modified" | "added" | "deleted" | "renamed" | "untracked" | "unmerged";
  type GitFileEntry = { path: string; status: GitFileStatus };

  function execGit(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolvePromise) => {
      execFile("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        // `git diff` (and `--is-inside-work-tree` for a non-repo) exit non-zero
        // for perfectly normal outcomes, not just real errors — callers decide
        // what a given code means for the command they ran.
        const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
        resolvePromise({ stdout, stderr, code });
      });
    });
  }

  // git status --porcelain=v1 lines are "XY PATH", X=index status, Y=worktree
  // status; a rename is "XY old -> new". Doesn't handle git's quoted-path
  // escaping for unusual filenames (unicode/spaces edge cases) — good enough
  // for a sidebar status list, not a general-purpose porcelain parser.
  function parseGitStatus(output: string): GitFileEntry[] {
    return output
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => {
        const x = line[0];
        const y = line[1];
        let path = line.slice(3);
        const arrow = path.indexOf(" -> ");
        if (arrow !== -1) path = path.slice(arrow + 4);

        let status: GitFileStatus;
        if (x === "?" && y === "?") status = "untracked";
        else if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) status = "unmerged";
        else if (x === "R" || y === "R") status = "renamed";
        else if (x === "A" || y === "A") status = "added";
        else if (x === "D" || y === "D") status = "deleted";
        else status = "modified";
        return { path, status };
      });
  }

  registerCoreMethod("git.status", async (params, ctx, connectionId) => {
    if (!isLoopbackConnection(connectionId) && !(await isTrustedDeviceConnection(ctx.workspaceRoot, connectionId))) {
      await requireFsApproval(ctx, "git.status", params, "moderate", connectionId);
    }
    const root = ctx.workspaceRoot;
    if (!root) throw new Error("git.status: this gateway has no workspaceRoot");

    const check = await execGit(root, ["rev-parse", "--is-inside-work-tree"]);
    if (check.code !== 0) return { isRepo: false, files: [] };

    const [branchRes, statusRes] = await Promise.all([
      execGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]),
      execGit(root, ["status", "--porcelain=v1"]),
    ]);
    if (statusRes.code !== 0) {
      throw new Error(`git.status: ${statusRes.stderr || statusRes.stdout || "git status failed"}`);
    }

    return {
      isRepo: true,
      branch: branchRes.code === 0 ? branchRes.stdout.trim() : undefined,
      files: parseGitStatus(statusRes.stdout),
    };
  });

  registerCoreMethod("git.diff", async (params, ctx, connectionId) => {
    if (!isLoopbackConnection(connectionId) && !(await isTrustedDeviceConnection(ctx.workspaceRoot, connectionId))) {
      await requireFsApproval(ctx, "git.diff", params, "moderate", connectionId);
    }
    const root = ctx.workspaceRoot;
    if (!root) throw new Error("git.diff: this gateway has no workspaceRoot");

    const relativePath = String(params.relativePath ?? "");
    if (!relativePath) throw new Error("git.diff: relativePath is required");
    const target = resolveWithinRoot(root, "git.diff", relativePath);

    // Untracked files have nothing in the index for `git diff` to compare
    // against — render them as a synthetic "all added" diff instead of
    // shelling out to `git diff --no-index` (which needs a real "empty file"
    // path and isn't cross-platform-clean with /dev/null on Windows).
    if (params.untracked === true) {
      try {
        const content = await readFile(target, "utf8");
        const lines = content.length > 0 ? content.split("\n") : [];
        const diff = [
          `--- /dev/null`,
          `+++ b/${relativePath}`,
          `@@ -0,0 +1,${lines.length} @@`,
          ...lines.map((line) => `+${line}`),
        ].join("\n");
        return { diff };
      } catch (err) {
        return { diff: `(unable to read file: ${err instanceof Error ? err.message : String(err)})` };
      }
    }

    const res = await execGit(root, ["diff", "--no-color", "--", relativePath]);
    if (res.code > 1) throw new Error(`git.diff: ${res.stderr || res.stdout || "git diff failed"}`);
    return { diff: res.stdout };
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

    const result = await runChannelTurn({
      message,
      config: ctx.config,
      workspaceRoot: ctx.workspaceRoot ?? undefined,
      sessionStore: ctx.sessionStore,
      approveTool: approvalHandler,
      approvalMode: getApprovalMode(sessionKey),
      events: ctx.events,
      onDelta: (delta) => {
        void ctx.events.emit("chat.delta", {
          sessionKey,
          text: delta,
          partial: true,
        });
      },
    });

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

  registerCoreMethod("turns.recent", async () => ({
    turns: getTurnLogSnapshot(),
  }));

  registerCoreMethod("automation.author", async (params, ctx) => {
    const system = String(params.system ?? "");
    const user = String(params.user ?? "");
    if (!user.trim()) throw new Error("automation.author: user is required");
    const agent = (ctx.config.agents ?? []).find((a) => a.id === ctx.config.defaultAgent);
    if (!agent?.provider || !agent.model) {
      throw new Error("automation.author: default agent has no provider/model");
    }
    const provider = getProvider(agent.provider);
    if (!provider?.chatComplete) {
      throw new Error(`automation.author: provider "${agent.provider}" cannot chat`);
    }
    const providerCfg = resolveProviderConfig(ctx.config, agent.provider);
    const result = await provider.chatComplete(
      { config: providerCfg },
      {
        model: agent.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.2,
      },
    );
    return { text: result.text, model: result.model };
  });

  registerCoreMethod("chat.subscribe", async () => ({
    subscribed: true,
    note: "Subscribe via WebSocket events: chat.final, chat.delta",
  }));

  registerCoreMethod("config.get", async (_params, ctx) => {
    const workspaceRoot = ctx.workspaceRoot;
    if (!workspaceRoot) {
      return {
        config: sanitizeConfigForClient(ctx.config),
        workspaceRoot: null,
        configPath: null,
      };
    }
    const { config, path } = await readConfigFile(workspaceRoot);
    const globalAgents = await readGlobalAgents();
    const mergedConfig = { ...config, agents: mergeAgentSources(config.agents ?? [], globalAgents) };
    return {
      config: sanitizeConfigForClient(mergedConfig),
      workspaceRoot,
      configPath: path,
    };
  });

  registerCoreMethod("config.patch", async (params, ctx) => {
    const workspaceRoot = ctx.workspaceRoot;
    if (!workspaceRoot) throw new Error("workspaceRoot not configured");

    const { patch, hotReloadedKeys, restartRequiredKeys } = validateConfigPatch(
      params as Record<string, unknown>,
    );

    const { config: current } = await readConfigFile(workspaceRoot);

    // Deep-merge channels so partial updates don't wipe existing accounts
    let channels = current.channels;
    if (patch.channels) {
      channels = { ...current.channels };
      for (const [id, ch] of Object.entries(patch.channels)) {
        channels[id] = { ...channels[id], ...ch };
      }
    }

    const pluginConfig = patch.pluginConfig
      ? { ...current.pluginConfig, ...patch.pluginConfig }
      : current.pluginConfig;

    // Merge agents by id instead of replacing the array wholesale. The
    // client's `patch.agents` is a snapshot fetched whenever its config.get
    // ran (e.g. when the Settings modal opened) — it can predate an
    // agents.create() that landed through a completely different flow
    // (AgentManager) in the meantime. A blind replace here would silently
    // delete that just-created agent the moment the user saved Settings for
    // anything unrelated. Union by id: patch entries add/update, anything
    // only on disk survives untouched.
    let agents = current.agents;
    if (patch.agents) {
      const byId = new Map((current.agents ?? []).map((a) => [a.id, a]));
      for (const a of patch.agents) byId.set(a.id, a);
      agents = [...byId.values()];
    }

    // Merge providers per-id-and-per-field against current on-disk state,
    // same reasoning as the agents merge above: a naive replace would let
    // editing one provider's baseUrl silently drop another provider's (or
    // that same provider's own untouched) apiKey/defaultModel.
    let providers = current.providers;
    if (patch.providers) {
      providers = { ...current.providers };
      for (const [id, p] of Object.entries(patch.providers)) {
        providers[id] = { ...providers[id], ...p };
      }
    }

    // Same per-id field merge as providers above, and for the same reason:
    // env/headers are stripped out of every config.get response (see
    // sanitizeConfigForClient), so a patch only carries them when the user
    // actually edited that server's secrets — anything else in the patch
    // entry (transport/command/args/url) always merges over the on-disk
    // entry, but an omitted env/headers key here must leave the existing
    // one untouched rather than being treated as "clear it".
    let mcpServers = current.mcpServers;
    if (patch.mcpServers) {
      mcpServers = { ...current.mcpServers };
      for (const [id, s] of Object.entries(patch.mcpServers)) {
        mcpServers[id] = { ...mcpServers[id], ...s } as typeof s;
      }
    }

    const fullPatch = { ...patch, channels, pluginConfig, agents, providers, mcpServers };

    // Write to disk
    const filePath = await writeConfigFile(workspaceRoot, fullPatch);

    // Apply in-memory immediately
    const globalAgents = await readGlobalAgents();
    const newConfig = mergeConfig(ctx.config, fullPatch);
    newConfig.agents = mergeAgentSources(newConfig.agents ?? [], globalAgents);
    ctx.config = newConfig;
    ctx.channelManager?.updateConfig(newConfig);

    // Hot-reload channels: stop disabled, start newly-enabled
    const channelChanges: Array<{ channelId: string; accountId: string; action: "started" | "stopped" }> = [];
    if (patch.channels && ctx.channelManager) {
      for (const [channelId, ch] of Object.entries(patch.channels)) {
        const wasEnabled = current.channels?.[channelId]?.enabled !== false;
        const nowEnabled = (ch as { enabled?: boolean }).enabled !== false;
        const running = ctx.channelManager
          .status()
          .some((s) => s.channelId === channelId && s.running);

        if (wasEnabled && !nowEnabled && running) {
          await ctx.channelManager.stopChannel(channelId, "default");
          channelChanges.push({ channelId, accountId: "default", action: "stopped" });
        } else if (!wasEnabled && nowEnabled && !running) {
          try {
            await ctx.channelManager.startChannel(channelId, "default");
            channelChanges.push({ channelId, accountId: "default", action: "started" });
          } catch (err) {
            ctx.logger.warn(`config.patch: failed to start channel ${channelId}`, {
              error: String(err),
            });
          }
        }
      }
    }

    // mcpServers changes don't connect on their own, but they no longer need
    // a restart: callers follow up with `mcp.reload` (tool-mcp), which diffs
    // the new config against what is connected.
    const requiresRestart = restartRequiredKeys.length > 0;

    return {
      ok: true,
      path: filePath,
      hotReloaded: hotReloadedKeys,
      requiresRestart,
      restartRequiredKeys,
      channelChanges,
      config: sanitizeConfigForClient(newConfig),
    };
  });

  // "Paired devices" screen (remote-access-analysis.md §5 point 4). Reads
  // straight off ApiKeyEntry (config/src/auth.ts) — no new backend primitive,
  // just the two operations that primitive was missing a way to reach:
  // listing without ever exposing the raw key (config.get already omits
  // apiKeys entirely — see sanitizeConfigForClient — this is the one place
  // that's allowed to know about them, and even here only a preview) and
  // revoking one by name.
  registerCoreMethod("auth.apiKeys.list", async (_params, ctx) => {
    const config = ctx.workspaceRoot ? (await readConfigFile(ctx.workspaceRoot)).config : ctx.config;
    const entries = config.auth?.gateway?.apiKeys ?? [];
    return {
      apiKeys: entries.map((e) => ({
        name: e.name,
        expiresAt: e.expiresAt,
        // Last 4 chars only — enough for the user to recognize which device
        // this is without the full key ever leaving the gateway again after
        // it was first issued.
        keyPreview: e.key ? `••••${e.key.slice(-4)}` : undefined,
      })),
    };
  });

  registerCoreMethod("auth.apiKeys.revoke", async (params, ctx) => {
    const name = String(params.name ?? "").trim();
    if (!name) throw new Error("auth.apiKeys.revoke: name is required");
    const workspaceRoot = ctx.workspaceRoot;
    if (!workspaceRoot) throw new Error("auth.apiKeys.revoke: this gateway has no workspaceRoot");

    const { config: current } = await readConfigFile(workspaceRoot);
    const existing = current.auth?.gateway?.apiKeys ?? [];
    const remaining = existing.filter((e) => e.name !== name);
    if (remaining.length === existing.length) {
      throw new Error(`auth.apiKeys.revoke: no apiKey named "${name}"`);
    }

    // Deep-merged by hand rather than via config.patch's validateConfigPatch
    // pipeline (same reasoning as agents.create/update/delete) — auth isn't
    // one of mergeConfig's explicitly-merged keys, so writing just
    // {auth:{gateway:{apiKeys}}} would silently drop apiKey/required
    // (the legacy single key + the require-auth flag) if not spread through
    // by hand first.
    const patch = {
      auth: {
        ...current.auth,
        gateway: { ...current.auth?.gateway, apiKeys: remaining },
      },
    };
    await writeConfigFile(workspaceRoot, patch);
    ctx.config = mergeConfig(ctx.config, patch);

    return { ok: true, revoked: name, remaining: remaining.length };
  });

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
