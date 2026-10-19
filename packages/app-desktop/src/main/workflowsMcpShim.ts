import { createInterface } from "node:readline";

/**
 * Standalone entry (built by electron-vite as its own bundle — see
 * electron.vite.config.ts's `main.build.rollupOptions.input` — so it can be
 * spawned as `node <resolved path>` independent of Electron itself), same
 * shape as paneControlMcpShim.ts: a minimal hand-rolled MCP server (just
 * enough of the spec for tools/list + tools/call) over stdio.
 *
 * Unlike the pane/plugins shims (which proxy to paneControlServer.ts's own
 * loopback HTTP API, an Electron-main-process-only concern), workflows live
 * entirely as gateway RPC methods — this shim is instead a thin WS client of
 * THIS project's own gateway subprocess (ws://127.0.0.1:<port>, see
 * writeWorkflowsMcpConfig / gateway.ts's ensureGateway), using Node 22's
 * built-in global `WebSocket` so no new dependency is needed. The wire
 * format is the gateway's own (`{id, method, params}` -> `{id, result}` /
 * `{id, error}` / `{type:"event", ...}` broadcasts, which this shim ignores
 * — see packages/gateway/src/server.ts's `ws.on("message", ...)`), not JSON-
 * RPC 2.0.
 *
 * Tool surface matches notes/automation/workflows-design.md §7.6 exactly —
 * deliberately NOT a 1:1 mirror of every workflows.* gateway method: no
 * grant/revokeGrant/setEnabled/cancel/delete here. Granting in particular
 * stays desktop-only by design (workflows.grant itself throws for any
 * non-loopback-at-the-gateway caller, but this shim's own loopback WS
 * connection WOULD pass that check — the restriction is enforced here, at
 * the tool surface, on purpose: a Claude session should be able to read,
 * validate, save, and run a workflow, but never self-grant the risky nodes
 * it just wrote).
 */

type GatewayRpcMessage = {
  id?: string;
  type?: string;
  result?: unknown;
  error?: { code: string; message: string };
};

type JsonRpcMessage = { jsonrpc: "2.0"; id?: string | number; method: string; params?: Record<string, unknown> };

const GATEWAY_URL = process.env.WORKFLOWS_GATEWAY_URL;

function logError(...args: unknown[]): void {
  // stdout is the JSON-RPC channel — diagnostics must go to stderr only.
  console.error("[workflows-mcp]", ...args);
}

if (!GATEWAY_URL) {
  logError("missing WORKFLOWS_GATEWAY_URL env var — tool calls will fail");
}

const CALL_TIMEOUT_MS = 30_000;

let socket: WebSocket | null = null;
let connecting: Promise<WebSocket> | null = null;
let nextCallId = 1;
const pendingCalls = new Map<string, { resolve: (v: unknown) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>();

function rejectAllPending(reason: string): void {
  for (const [id, p] of pendingCalls) {
    clearTimeout(p.timer);
    p.reject(new Error(reason));
    pendingCalls.delete(id);
  }
}

function connect(): Promise<WebSocket> {
  if (socket && socket.readyState === WebSocket.OPEN) return Promise.resolve(socket);
  if (connecting) return connecting;
  if (!GATEWAY_URL) return Promise.reject(new Error("WORKFLOWS_GATEWAY_URL not set — is this project open in the desktop app?"));

  connecting = new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(GATEWAY_URL);

    ws.addEventListener("open", () => {
      socket = ws;
      connecting = null;
      resolve(ws);
    });

    ws.addEventListener("message", (event: MessageEvent) => {
      let msg: GatewayRpcMessage;
      try {
        msg = JSON.parse(String(event.data)) as GatewayRpcMessage;
      } catch {
        return;
      }
      if (msg.type === "event" || msg.id === undefined) return; // broadcast event (workflow.*, fs.changed, ...) — this shim is request/response only
      const pending = pendingCalls.get(msg.id);
      if (!pending) return;
      pendingCalls.delete(msg.id);
      clearTimeout(pending.timer);
      if (msg.error) pending.reject(new Error(msg.error.message));
      else pending.resolve(msg.result);
    });

    ws.addEventListener("error", () => {
      connecting = null;
      reject(new Error(`could not connect to this project's gateway at ${GATEWAY_URL}`));
    });

    ws.addEventListener("close", () => {
      socket = null;
      connecting = null;
      rejectAllPending("gateway connection closed");
    });
  });

  return connecting;
}

async function rpcCall(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const ws = await connect();
  const id = String(nextCallId++);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCalls.delete(id);
      reject(new Error(`${method}: timed out waiting for this project's gateway`));
    }, CALL_TIMEOUT_MS);
    pendingCalls.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const TOOLS = [
  {
    name: "workflows_list",
    description:
      "Lists every workflow defined in this project (<project>/.yggdrasil/workflows/), each with its grant " +
      'status ("not_required" | "none" | "stale" | "granted" — "stale" means the workflow changed since it ' +
      "was last granted and needs re-granting from the desktop app's Workflows tab before it can run).",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "workflows_get",
    description: "Returns one workflow's full definition (nodes, edges, triggers, settings) by id.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "workflows_validate",
    description:
      "Validates a workflow definition against the engine's rules (dangling edges, duplicate node ids, loop " +
      "subgraph shape, etc.) WITHOUT saving it — use this to check a draft before workflows_save. Returns a " +
      "list of errors (empty if valid).",
    inputSchema: {
      type: "object",
      properties: { workflow: { type: "object", description: "A full Workflow object — see notes/automation/workflows-design.md §3 for the shape, and workflows_list/workflows_get for real examples." } },
      required: ["workflow"],
    },
  },
  {
    name: "workflows_save",
    description:
      "Creates or overwrites (same id = overwrite) a workflow definition in this project. Rejects an invalid " +
      "workflow (same checks as workflows_validate). If the workflow has any risky (non-safe) node, it CANNOT " +
      "run until a human grants it from the desktop app's Workflows tab — this tool can write the workflow but " +
      "never grant it.",
    inputSchema: {
      type: "object",
      properties: { workflow: { type: "object" } },
      required: ["workflow"],
    },
  },
  {
    name: "workflows_run",
    description:
      "Runs a workflow now (a \"manual\" trigger) and waits for it to finish, returning the full Run (status, " +
      "per-node states/outputs, any error). Fails with a clear reason instead of a run if: the kill switch is " +
      "on (automation_paused), a run for this workflow is already in flight (concurrency_skip), the workflow " +
      "is invalid, or it has an ungranted risky node (grant_required — ask the user to grant it from the " +
      "desktop app's Workflows tab first).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        input: { type: "object", description: "Optional payload, available in node expressions as `{{ trigger.payload }}`." },
      },
      required: ["id"],
    },
  },
  {
    name: "workflows_runs",
    description:
      "Lists past runs of a workflow (most recent first), or — if `runId` is given — returns that one run's " +
      "full detail instead of a list.",
    inputSchema: {
      type: "object",
      properties: {
        workflowId: { type: "string", description: "Omit to list runs across every workflow in this project." },
        limit: { type: "number", description: "Max runs to return when listing. Defaults to the store's own default." },
        runId: { type: "string", description: "If set, ignores workflowId/limit and returns just this one run." },
      },
      required: [],
    },
  },
];

function textResult(text: string, isError = false): { content: Array<{ type: "text"; text: string }>; isError: boolean } {
  return { content: [{ type: "text", text }], isError };
}

async function callTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "workflows_list": {
      const result = await rpcCall("workflows.list");
      return textResult(JSON.stringify(result, null, 2));
    }
    case "workflows_get": {
      const { id } = args as { id?: string };
      if (!id) return textResult("workflows_get: id is required", true);
      const result = await rpcCall("workflows.get", { id });
      return textResult(JSON.stringify(result, null, 2));
    }
    case "workflows_validate": {
      const { workflow } = args as { workflow?: unknown };
      if (!workflow) return textResult("workflows_validate: workflow is required", true);
      const result = await rpcCall("workflows.validate", { workflow });
      return textResult(JSON.stringify(result, null, 2));
    }
    case "workflows_save": {
      const { workflow } = args as { workflow?: unknown };
      if (!workflow) return textResult("workflows_save: workflow is required", true);
      const result = await rpcCall("workflows.save", { workflow });
      return textResult(JSON.stringify(result, null, 2));
    }
    case "workflows_run": {
      const { id, input } = args as { id?: string; input?: Record<string, unknown> };
      if (!id) return textResult("workflows_run: id is required", true);
      const result = await rpcCall("workflows.run", input ? { id, input } : { id });
      return textResult(JSON.stringify(result, null, 2));
    }
    case "workflows_runs": {
      const { workflowId, limit, runId } = args as { workflowId?: string; limit?: number; runId?: string };
      if (runId) {
        const result = await rpcCall("workflows.runs.get", { runId });
        return textResult(JSON.stringify(result, null, 2));
      }
      const result = await rpcCall("workflows.runs.list", {
        ...(workflowId ? { workflowId } : {}),
        ...(typeof limit === "number" ? { limit } : {}),
      });
      return textResult(JSON.stringify(result, null, 2));
    }
    default:
      return textResult(`Unknown tool "${name}"`, true);
  }
}

function send(msg: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

async function handle(msg: JsonRpcMessage): Promise<void> {
  const { id, method, params } = msg;

  // Notifications (no id) never get a response, by spec.
  if (id === undefined) return;

  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: (params?.protocolVersion as string) ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "yggdrasil-workflows", version: "0.1.0" },
      },
    });
    return;
  }

  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    return;
  }

  if (method === "tools/call") {
    const name = params?.name as string;
    const args = (params?.arguments as Record<string, unknown>) ?? {};
    try {
      send({ jsonrpc: "2.0", id, result: await callTool(name, args) });
    } catch (err) {
      send({ jsonrpc: "2.0", id, result: textResult(err instanceof Error ? err.message : String(err), true) });
    }
    return;
  }

  if (method === "ping") {
    send({ jsonrpc: "2.0", id, result: {} });
    return;
  }

  send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg: JsonRpcMessage;
  try {
    msg = JSON.parse(trimmed) as JsonRpcMessage;
  } catch {
    return;
  }
  void handle(msg).catch((err) => logError("unhandled error", err));
});

process.stdin.resume();
