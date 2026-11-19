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


const PROJECT_ROOT = process.env.YGGDRASIL_PROJECT_ROOT;

function logError(...args: unknown[]): void {
  // stdout is the JSON-RPC channel — diagnostics must go to stderr only.
  console.error("[memory-control-mcp]", ...args);
}

if (!PROJECT_ROOT) {
  logError("missing YGGDRASIL_PROJECT_ROOT env var — tool calls will fail");
}

const ctx: ToolContext = { sessionKey: "memory-mcp", config: {}, workspaceRoot: PROJECT_ROOT };

export const TOOLS: AgentToolDefinition[] = [
  pluginDataSearchTool,
  memoryAddTool,
  memoryListTool,
  memorySearchTool,
  memoryUpdateTool,
  memoryRemoveTool,
];

export function toMcpTool(tool: AgentToolDefinition) {
  return { name: tool.name, description: tool.description, inputSchema: tool.parameters };
}

function textResult(text: string, isError = false): { content: Array<{ type: "text"; text: string }>; isError: boolean } {
  return { content: [{ type: "text", text }], isError };
}

export async function callTool(name: string, args: Record<string, unknown>) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return textResult(`Unknown tool "${name}"`, true);
  try {
    const result = await tool.execute(ctx, args);
    return textResult(JSON.stringify(result, null, 2));
  } catch (err) {
    return textResult(err instanceof Error ? err.message : String(err), true);
  }
}
