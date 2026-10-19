import { createServer as createHttpServer, type Server as HttpServer, type IncomingMessage } from "node:http";
import { isForThisConnection } from "./deviceRouting.js";
import { isTrustedLoopback } from "./loopbackTrust.js";
import { TunnelHub } from "./tunnel.js";
import { validateGatewayApiKey } from "@yggdrasil/config";
import { createAssistantServices, registerAssistantTools, type AssistantServices } from "./assistant/services.js";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import type { YggdrasilConfig } from "@yggdrasil/config";
import type { GatewayRequest, GatewayResponse } from "@yggdrasil/sdk";
import { ChannelManager } from "./channel-manager.js";
import {
  isWsAuthenticatedByDefault,
  tryAuthenticateFromQuery,
  tryAuthenticateFromRequest,
} from "./auth.js";
import {
  createDefaultGatewayContext,
  handleGatewayConnectionClosed,
  handleGatewayRequest,
  registerConnectionRemoteAddress,
  type GatewayContext,
  setAssistantServices,
  setTunnelLookup,
} from "./methods.js";
import { tryServeUi } from "./static-ui.js";
import { startFsWatcher } from "./fs-watch.js";

import type { ToolApprovalHandler } from "@yggdrasil/sdk";

export type GatewayServerOptions = {
  config: YggdrasilConfig;
  workspaceRoot?: string;
  startChannels?: boolean;
  approveTool?: ToolApprovalHandler;
};

export type GatewayServer = {
  httpServer: HttpServer;
  wss: WebSocketServer;
  channelManager: ChannelManager;
  context: GatewayContext;
  port: number;
  close: () => Promise<void>;
};

function parseMessage(data: Buffer | ArrayBuffer | Buffer[]): GatewayRequest | null {
  try {
    const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
    const parsed = JSON.parse(text) as GatewayRequest;
    if (!parsed || typeof parsed !== "object" || typeof parsed.method !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function sendJson(ws: WebSocket, payload: GatewayResponse | Record<string, unknown>): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function sendHttpJson(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  res.end(text);
}

const WEBHOOK_MAX_BODY_BYTES = 1 * 1024 * 1024; // a trigger payload, not a file upload — workflows-design.md §7.3

async function readWebhookBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > WEBHOOK_MAX_BODY_BYTES) throw new Error("webhook body too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseBearerToken(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

/**
 * `POST|GET /hooks/workflows/:id` — the remote-trigger entry point for
 * `webhook` triggers (workflows-design.md §7.3). This is deliberately just a
 * thin HTTP-to-RPC bridge: all real workflow knowledge (validation, auth
 * against the trigger's secret, running it) lives in the `workflows.runWebhook`
 * gateway method registered by extensions/service-workflows — the gateway
 * package itself never imports anything from that plugin, same as it never
 * imports any other plugin's package.
 */
const webhookRateLimitHits = new Map<string, number[]>();
const WEBHOOK_RATE_LIMIT = 10;
const WEBHOOK_RATE_WINDOW_MS = 60_000;

function allowWebhookRequest(workflowId: string, now = Date.now()): boolean {
  const windowStart = now - WEBHOOK_RATE_WINDOW_MS;
  const hits = (webhookRateLimitHits.get(workflowId) ?? []).filter((t) => t > windowStart);
  if (hits.length >= WEBHOOK_RATE_LIMIT) {
    webhookRateLimitHits.set(workflowId, hits);
    return false;
  }
  hits.push(now);
  webhookRateLimitHits.set(workflowId, hits);
  return true;
}

async function handleWorkflowWebhook(
  workflowId: string,
  req: IncomingMessage,
  res: import("node:http").ServerResponse,
  url: URL,
  context: GatewayContext,
): Promise<void> {
  if (!allowWebhookRequest(workflowId)) {
    sendHttpJson(res, 429, { ok: false, reason: "rate_limited" });
    return;
  }

  const bearerToken = parseBearerToken(req.headers.authorization);
  const signatureHeader = req.headers["x-ygg-signature"];
  const signatureHex = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

  let payload: unknown;
  let rawBody: string | undefined;
  try {
    if (req.method === "POST") {
      rawBody = await readWebhookBody(req);
      try {
        payload = rawBody.length > 0 ? JSON.parse(rawBody) : undefined;
      } catch {
        payload = rawBody;
      }
    } else {
      payload = Object.fromEntries(url.searchParams);
    }
  } catch (err) {
    sendHttpJson(res, 413, { ok: false, reason: "body_too_large", message: err instanceof Error ? err.message : String(err) });
    return;
  }

  const response = await handleGatewayRequest(
    { method: "workflows.runWebhook", params: { id: workflowId, method: req.method, bearerToken, signatureHex, rawBody, payload } },
    context,
    randomUUID(),
  );

  if (response.error) {
    const status = response.error.code === "METHOD_NOT_FOUND" ? 404 : 500;
    sendHttpJson(res, status, { ok: false, reason: response.error.code, message: response.error.message });
    return;
  }

  const result = (response.result ?? { ok: true }) as { status?: number };
  sendHttpJson(res, result.status ?? 200, result);
}

export async function startGatewayServer(options: GatewayServerOptions): Promise<GatewayServer> {
  const host = options.config.gateway?.host ?? "127.0.0.1";
  const port = options.config.gateway?.port ?? 18789;
  const context = await createDefaultGatewayContext(
    options.config,
    undefined,
    options.workspaceRoot,
  );

  const channelManager = new ChannelManager({
    config: options.config,
    workspaceRoot: options.workspaceRoot,
    approveTool: options.approveTool,
    events: context.events,
  });

  context.channelManager = channelManager;

  // Push, reminders and the offline-action queue need a persistent workspace
  // (the Railway volume) — they only run for the real long-lived gateway.
  let assistantServices: AssistantServices | null = null;
  if (options.workspaceRoot) {
    assistantServices = await createAssistantServices({
      workspaceRoot: options.workspaceRoot,
      events: context.events,
      sessionStore: context.sessionStore,
    });
    setAssistantServices(assistantServices);
    registerAssistantTools(assistantServices);
    assistantServices.start();
  }

  const tlsCfg = options.config.gateway?.tls;
  const requestHandler = async (req: IncomingMessage, res: import("node:http").ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const hookMatch = (req.method === "POST" || req.method === "GET") ? /^\/hooks\/workflows\/([^/]+)\/?$/.exec(url.pathname) : null;
    if (hookMatch) {
      await handleWorkflowWebhook(decodeURIComponent(hookMatch[1]!), req, res, url, context);
      return;
    }
    if (await tryServeUi(req, res)) return;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "yggdrasil-gateway", ui: "/ui" }));
  };

  const httpServer: HttpServer = tlsCfg?.cert && tlsCfg?.key
    ? createHttpsServer(
        {
          cert: readFileSync(tlsCfg.cert, "utf8"),
          key: readFileSync(tlsCfg.key, "utf8"),
        },
        requestHandler,
      )
    : createHttpServer(requestHandler);

  const wss = new WebSocketServer({ noServer: true });

  // Phone link phase B: /tunnel-host/* and /tunnel/* are relay sockets, not the
  // gateway protocol (tunnel.ts). Everything else is a normal gateway socket.
  const tunnelHub = new TunnelHub({
    validateHostKey: (key) => validateGatewayApiKey(key, options.config),
    desktopKey: (desktopId) => assistantServices?.desktops.gatewayKeyOf(desktopId),
  });
  setTunnelLookup((desktopId) => tunnelHub.isAttached(desktopId));
  httpServer.on("upgrade", (req, socket, head) => {
    if (tunnelHub.handleUpgrade(req, socket, head)) return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws, req: IncomingMessage) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    // Traffic the desktop relays from the Railway tunnel arrives from 127.0.0.1
    // but is a remote phone: the desktop marks it, and it gets no local trust
    // (must send the key; no loopback exemptions).
    const viaTunnel = req.headers["x-yggdrasil-tunnel"] === "1";
    const trustedLocal = !viaTunnel && isTrustedLoopback(req.socket.remoteAddress);
    const state = {
      authenticated:
        isWsAuthenticatedByDefault(options.config) ||
        tryAuthenticateFromQuery(options.config, url.searchParams.get("apiKey")) ||
        trustedLocal,
    };
    // Identifies this socket to methods.ts's device-tools handlers (device
    // tool registration/lookup is per-connection, not part of the shared
    // GatewayContext — see the comment on GatewayMethodHandler).
    const connectionId = randomUUID();
    // req.socket.remoteAddress is the real OS socket peer address, not a
    // client-suppliable header — lets fs.list/fs.read (methods.ts) trust a
    // verified-loopback connection without reopening the fs.* approval gate
    // for LAN/Tailscale/phone connections once the gateway binds 0.0.0.0.
    registerConnectionRemoteAddress(connectionId, viaTunnel ? "tunnel" : req.socket.remoteAddress);

    const unsubFinal = context.events.on("chat.final", (payload) => {
      sendJson(ws, { type: "event", event: "chat.final", payload });
    });
    const unsubDelta = context.events.on("chat.delta", (payload) => {
      sendJson(ws, { type: "event", event: "chat.delta", payload });
    });
    const unsubApprovalReq = context.events.on("tool.approval.requested", (payload) => {
      sendJson(ws, { type: "event", event: "tool.approval.requested", payload });
    });
    const unsubApprovalRes = context.events.on("tool.approval.resolved", (payload) => {
      sendJson(ws, { type: "event", event: "tool.approval.resolved", payload });
    });
    const unsubTurnStart = context.events.on("turn.start", (payload) => {
      sendJson(ws, { type: "event", event: "turn.start", payload });
    });
    const unsubTurnEnd = context.events.on("turn.end", (payload) => {
      sendJson(ws, { type: "event", event: "turn.end", payload });
    });
    const unsubToolExec = context.events.on("tool.execute", (payload) => {
      sendJson(ws, { type: "event", event: "tool.execute", payload });
    });
    const unsubProviderLatency = context.events.on("provider.latency", (payload) => {
      sendJson(ws, { type: "event", event: "provider.latency", payload });
    });
    const unsubApprovalModeChanged = context.events.on("tools.approvalMode.changed", (payload) => {
      sendJson(ws, { type: "event", event: "tools.approvalMode.changed", payload });
    });
    // Agent Flow "Run Flow" needs this to learn a delegated node's real
    // sub-session key and join its terminal pane to it — see
    // invoke-agent-tool.ts (emitter) and useAgentFlowRunEvents.ts (consumer).
    const unsubDelegateStart = context.events.on("agentflow.delegate.start", (payload) => {
      sendJson(ws, { type: "event", event: "agentflow.delegate.start", payload });
    });
    // Device-tools protocol (notes/yggdrasil-mobile/phone-gateway-connectivity-design.md
    // section 3) — broadcast to every connected client same as the approval
    // events above; only the phone connection that actually owns the named
    // tool acts on invoke.requested (device.tools.register), the rest just
    // ignore an unknown toolName.
    // Only the connection the call was addressed to gets it (payload.connectionId,
    // set by invokeDeviceTool): a phone can hold several connections at once
    // (app + quick-access bubble) and each knows the same tool names, so a
    // broadcast would run the tool once per connection.
    const unsubDeviceInvokeReq = context.events.on("device.tool.invoke.requested", (payload) => {
      if (!isForThisConnection(payload, connectionId)) return;
      sendJson(ws, { type: "event", event: "device.tool.invoke.requested", payload });
    });
    const unsubDeviceInvokeProgress = context.events.on("device.tool.invoke.progress", (payload) => {
      sendJson(ws, { type: "event", event: "device.tool.invoke.progress", payload });
    });
    const unsubDeviceInvokeCancel = context.events.on("device.tool.invoke.cancel", (payload) => {
      if (!isForThisConnection(payload, connectionId)) return;
      sendJson(ws, { type: "event", event: "device.tool.invoke.cancel", payload });
    });
    // See fs-watch.ts — lets FileTree.tsx auto-refresh instead of needing a
    // manual collapse/expand to notice files added outside the app.
    const unsubFsChanged = context.events.on("fs.changed", (payload) => {
      sendJson(ws, { type: "event", event: "fs.changed", payload });
    });
    // Content edits too (fs.changed is add/remove only) — DocumentsView.tsx
    // uses it to reflect a note an agent edited while it's open in a tab.
    const unsubFsContentChanged = context.events.on("fs.contentChanged", (payload) => {
      sendJson(ws, { type: "event", event: "fs.contentChanged", payload });
    });
    // context-memory-db's project_index_all — SessionSidebar.tsx's "Indx"
    // button progress bar.
    const unsubProjectIndexProgress = context.events.on("project_index.progress", (payload) => {
      sendJson(ws, { type: "event", event: "project_index.progress", payload });
    });
    // extensions/service-workflows — see notes/automation/workflows-design.md
    // §7.2. Broadcast to every connected client same as the tool/approval
    // events above; a run started from one client (desktop, mobile, or the
    // MCP shim) is visible to all of them.
    const unsubWorkflowRunStarted = context.events.on("workflow.run.started", (payload) => {
      sendJson(ws, { type: "event", event: "workflow.run.started", payload });
    });
    const unsubWorkflowNodeStarted = context.events.on("workflow.node.started", (payload) => {
      sendJson(ws, { type: "event", event: "workflow.node.started", payload });
    });
    const unsubWorkflowNodeFinished = context.events.on("workflow.node.finished", (payload) => {
      sendJson(ws, { type: "event", event: "workflow.node.finished", payload });
    });
    const unsubWorkflowRunFinished = context.events.on("workflow.run.finished", (payload) => {
      sendJson(ws, { type: "event", event: "workflow.run.finished", payload });
    });

    ws.on("message", async (data) => {
      const request = parseMessage(data as Buffer);
      if (!request) {
        sendJson(ws, { error: { code: "PARSE_ERROR", message: "Invalid JSON request" } });
        return;
      }

      if (!state.authenticated) {
        if (tryAuthenticateFromRequest(options.config, request)) {
          state.authenticated = true;
          sendJson(ws, { id: request.id, result: { ok: true } });
          return;
        }
        sendJson(ws, {
          id: request.id,
          error: {
            code: "UNAUTHORIZED",
            message: "Authentication required. Send { method: 'auth', params: { apiKey } } first.",
          },
        });
        return;
      }

      try {
        const response = await handleGatewayRequest(request, context, connectionId);
        // A trusted local socket needs no key: say so, or clients that gate on
        // health.authRequired (the desktop window) wait for a key they don't have.
        if (trustedLocal && request.method === "health" && response.result && typeof response.result === "object") {
          response.result = { ...(response.result as Record<string, unknown>), authRequired: false };
        }
        sendJson(ws, response);
      } catch (err) {
        sendJson(ws, {
          id: request.id,
          error: {
            code: "INTERNAL_ERROR",
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }
    });

    ws.on("close", () => {
      unsubFinal();
      unsubDelta();
      unsubApprovalReq();
      unsubApprovalRes();
      unsubTurnStart();
      unsubTurnEnd();
      unsubToolExec();
      unsubProviderLatency();
      unsubApprovalModeChanged();
      unsubDelegateStart();
      unsubDeviceInvokeReq();
      unsubDeviceInvokeProgress();
      unsubDeviceInvokeCancel();
      unsubFsChanged();
      unsubFsContentChanged();
      unsubProjectIndexProgress();
      unsubWorkflowRunStarted();
      unsubWorkflowNodeStarted();
      unsubWorkflowNodeFinished();
      unsubWorkflowRunFinished();
      // Drops this connection's registered device tools and rejects any
      // device tool call still waiting on it — an "interactive" one can't be
      // left hanging on its 10min ceiling just because the phone vanished.
      handleGatewayConnectionClosed(connectionId);
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(port, host, () => resolve());
    httpServer.on("error", reject);
  });

  if (options.startChannels !== false) {
    await channelManager.startAllEnabled();
  }

  // Only for the real long-lived gateway server — invokeGatewayMethod (CLI
  // one-shot calls) builds its own ephemeral context that never reaches
  // here, so it never starts a watcher it wouldn't stop.
  const stopFsWatcher = options.workspaceRoot ? await startFsWatcher(options.workspaceRoot, context.events) : null;

  return {
    httpServer,
    wss,
    channelManager,
    context,
    port,
    close: async () => {
      setTunnelLookup(null);
      tunnelHub.close();
      assistantServices?.stop();
      setAssistantServices(null);
      await stopFsWatcher?.();
      await channelManager.stopAll();
      // wss.close()'s callback only fires once every client has disconnected
      // on its own — a client that auto-reconnects (like hf-realtime-voice's
      // persistent bridge) can keep that from ever happening, hanging
      // shutdown indefinitely. Terminate any still-open sockets ourselves
      // first so close() always resolves promptly.
      for (const client of wss.clients) {
        client.terminate();
      }
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

export async function invokeGatewayMethod(
  method: string,
  params: Record<string, unknown>,
  config: YggdrasilConfig,
  sessionStore?: import("@yggdrasil/sessions").SessionStore | null,
  workspaceRoot?: string,
): Promise<unknown> {
  const context = await createDefaultGatewayContext(config, sessionStore, workspaceRoot);
  const response = await handleGatewayRequest({ method, params, id: 1 }, context);
  if (response.error) {
    throw new Error(`${response.error.code}: ${response.error.message}`);
  }
  return response.result;
}
