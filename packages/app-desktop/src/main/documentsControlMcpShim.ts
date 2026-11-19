import {
  listDocumentsTool,
  readDocumentTool,
  writeDocumentTool,
  deleteDocumentTool,
  renameDocumentTool,
} from "@yggdrasil/tool-documents";
import type { AgentToolDefinition, ToolContext } from "@yggdrasil/tools-sdk";

/**
 * Standalone entry (built by electron-vite as its own bundle — see
 * electron.vite.config.ts's `main.build.rollupOptions.input`), same
 * pattern as paneControlMcpShim.ts. A project's `.mcp.json` (written in
 * main/index.ts's openProject) points a `claude` CLI session at this file
 * over stdio.
 *
 * Unlike paneControlMcpShim.ts, there's no HTTP bridge back into the
 * Electron main process here — document tools are plain filesystem
 * operations scoped to <project>/notes with no live in-process state to
 * reach (no pty to control), so this just wraps @yggdrasil/tool-documents'
 * own tool definitions directly: same resolveWithinNotes escape-guard, same
 * PDF text extraction, same tests — a `claude` pane and the in-app Chat tab
 * call through to identical logic, not a second implementation.
 */


const PROJECT_ROOT = process.env.YGGDRASIL_PROJECT_ROOT;

function logError(...args: unknown[]): void {
  // stdout is the JSON-RPC channel — diagnostics must go to stderr only.
  console.error("[documents-control-mcp]", ...args);
}

if (!PROJECT_ROOT) {
  logError("missing YGGDRASIL_PROJECT_ROOT env var — tool calls will fail");
}

const ctx: ToolContext = { sessionKey: "documents-mcp", config: {}, workspaceRoot: PROJECT_ROOT };

export const TOOLS: AgentToolDefinition[] = [
  listDocumentsTool,
  readDocumentTool,
  writeDocumentTool,
  deleteDocumentTool,
  renameDocumentTool,
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
