import { createInterface } from "node:readline";
import * as panes from "./paneControlMcpShim.js";
import * as documents from "./documentsControlMcpShim.js";
import * as plugins from "./pluginsControlMcpShim.js";
import * as memory from "./memoryControlMcpShim.js";
import * as workflows from "./workflowsMcpShim.js";

/**
 * The single MCP server a `claude` session connects to (`yggdrasil` in the
 * project's `.mcp.json`). It used to be five separate stdio processes per
 * session (panes, documents, plugins, memory, workflows), each paying a whole
 * Node runtime; this one process serves all of their tools. The five modules
 * above only export their tool lists and `callTool`; this file owns the
 * JSON-RPC loop and routes each call to the family that declared the tool.
 *
 * Runs under Electron's Node (ELECTRON_RUN_AS_NODE) because the memory tools
 * pull in better-sqlite3 — see mcpConfig.ts's writeYggdrasilMcpConfig.
 */

type JsonRpcMessage = { jsonrpc: "2.0"; id?: string | number; method: string; params?: Record<string, unknown> };
type McpTool = { name: string; description: string; inputSchema: unknown };
type ToolResult = { content: Array<{ type: "text"; text: string }>; isError: boolean };
type Family = {
  name: string;
  tools: () => McpTool[];
  call: (name: string, args: Record<string, unknown>) => Promise<ToolResult>;
};

function logError(...args: unknown[]): void {
  // stdout is the JSON-RPC channel — diagnostics must go to stderr only.
  console.error("[yggdrasil-mcp]", ...args);
}

function textResult(text: string, isError = false): ToolResult {
  return { content: [{ type: "text", text }], isError };
}

const FAMILIES: Family[] = [
  { name: "panes", tools: () => panes.TOOLS as McpTool[], call: panes.callTool as Family["call"] },
  {
    name: "documents",
    tools: () => documents.TOOLS.map(documents.toMcpTool),
    call: documents.callTool as Family["call"],
  },
  // Plugins also lists the published complementos' own tools (see listAllTools).
  { name: "plugins", tools: () => plugins.TOOLS as McpTool[], call: plugins.callTool as Family["call"] },
  { name: "memory", tools: () => memory.TOOLS.map(memory.toMcpTool), call: memory.callTool as Family["call"] },
  { name: "workflows", tools: () => workflows.TOOLS as McpTool[], call: workflows.callTool as Family["call"] },
];

/** Tool name → the family that owns it, rebuilt on every tools/list (plugin tools can change between lists). */
let owners = new Map<string, Family>();

async function listAllTools(): Promise<McpTool[]> {
  const next = new Map<string, Family>();
  const all: McpTool[] = [];
  const add = (family: Family, tools: McpTool[]) => {
    for (const tool of tools) {
      const existing = next.get(tool.name);
      if (existing) {
        logError(`duplicate tool name "${tool.name}" (${family.name} vs ${existing.name}) — keeping the first`);
        continue;
      }
      next.set(tool.name, family);
      all.push(tool);
    }
  };
  for (const family of FAMILIES) {
    try {
      add(family, family.tools());
      if (family.name === "plugins") {
        const dynamic = await plugins.listDynamicTools().catch((err: unknown) => {
          logError("failed to fetch dynamic plugin tools", err);
          return [];
        });
        add(family, dynamic as McpTool[]);
      }
    } catch (err) {
      // One family failing to list must not take the other four down with it.
      logError(`listing ${family.name} tools failed`, err);
    }
  }
  owners = next;
  return all;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  // Claude Code normally lists before it calls, but don't depend on it.
  if (owners.size === 0) await listAllTools();
  const family = owners.get(name);
  if (!family) return textResult(`Unknown tool "${name}"`, true);
  try {
    return await family.call(name, args);
  } catch (err) {
    return textResult(err instanceof Error ? err.message : String(err), true);
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
        serverInfo: { name: "yggdrasil", version: "0.1.0" },
      },
    });
    return;
  }

  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: await listAllTools() } });
    return;
  }

  if (method === "tools/call") {
    const name = params?.name as string;
    const args = (params?.arguments as Record<string, unknown>) ?? {};
    send({ jsonrpc: "2.0", id, result: await callTool(name, args) });
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
