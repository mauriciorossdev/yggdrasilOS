import { createInterface } from "node:readline";
import {
  memoryAddTool,
  memoryListTool,
  memorySearchTool,
  memoryUpdateTool,
  memoryRemoveTool,
  pluginDataSearchTool,
} from "@yggdrasil/context-memory-db";
import type { AgentToolDefinition, ToolContext } from "@yggdrasil/tools-sdk";

/**
 * Standalone entry (built by electron-vite as its own bundle — see
 * electron.vite.config.ts), same pattern as documentsControlMcpShim.ts. A
 * project's `.mcp.json` (written in main/index.ts's openProject) points a
 * `claude` CLI session at this file over stdio.
 *
 * Wraps @yggdrasil/context-memory-db's own AgentToolDefinitions directly —
 * same "one implementation, two call paths" posture as
 * documentsControlMcpShim.ts (a `claude` pane and Yggdrasil's own internal
 * kernel-based agent runtime call through to identical logic). Deliberately
 * excludes project_index/project_index_all/project_search: those walk the
 * whole repo by file extension, which this integration intentionally does
 * NOT do (see notes/plugin-storage-search design note) — plugin_data_search
 * covers the one thing this shim actually indexes (installed plugins'
 * storage — a kanban board's cards, etc), kept live by app-desktop's own
 * pluginStorageIndex.ts hooking `plugins:storageSet`/`storageDelete`.
 */

type JsonRpcMessage = { jsonrpc: "2.0"; id?: string | number; method: string; params?: Record<string, unknown> };

const PROJECT_ROOT = process.env.YGGDRASIL_PROJECT_ROOT;

function logError(...args: unknown[]): void {
  // stdout is the JSON-RPC channel — diagnostics must go to stderr only.
  console.error("[memory-control-mcp]", ...args);
}

if (!PROJECT_ROOT) {
  logError("missing YGGDRASIL_PROJECT_ROOT env var — tool calls will fail");
}

const ctx: ToolContext = { sessionKey: "memory-mcp", config: {}, workspaceRoot: PROJECT_ROOT };

const TOOLS: AgentToolDefinition[] = [
  pluginDataSearchTool,
  memoryAddTool,
  memoryListTool,
  memorySearchTool,
  memoryUpdateTool,
  memoryRemoveTool,
];

function toMcpTool(tool: AgentToolDefinition) {
  return { name: tool.name, description: tool.description, inputSchema: tool.parameters };
}

function textResult(text: string, isError = false): { content: Array<{ type: "text"; text: string }>; isError: boolean } {
  return { content: [{ type: "text", text }], isError };
}

async function callTool(name: string, args: Record<string, unknown>) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return textResult(`Unknown tool "${name}"`, true);
  try {
    const result = await tool.execute(ctx, args);
    return textResult(JSON.stringify(result, null, 2));
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
        serverInfo: { name: "yggdrasil-memory-control", version: "0.1.0" },
      },
    });
    return;
  }

  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS.map(toMcpTool) } });
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
