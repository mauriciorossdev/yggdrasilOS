import { definePlugin } from "@yggdrasil/sdk";
import {
  listDocumentsTool,
  readDocumentTool,
  writeDocumentTool,
  deleteDocumentTool,
  renameDocumentTool,
} from "./tools.js";
import { resolveWithinNotes } from "./scope.js";
import { transcribeAudioTool } from "./transcribe.js";

// Re-exported (not just used internally) so documentsControlMcpShim.ts can
// wrap the exact same tool definitions/execute functions for `claude` CLI
// panes via MCP, instead of reimplementing the same fs logic a second time.
export { listDocumentsTool, readDocumentTool, writeDocumentTool, deleteDocumentTool, renameDocumentTool };
// Re-exported so other packages that need to read/write inside notes/ (e.g.
// tool-google's Drive upload) reuse this exact scoping/traversal guard
// instead of re-implementing it.
export { resolveWithinNotes };
export { transcribeAudioTool };

const tools = [listDocumentsTool, readDocumentTool, writeDocumentTool, deleteDocumentTool, renameDocumentTool, transcribeAudioTool];

const plugin = definePlugin({
  id: "tool-documents",
  name: "Documents Tools",
  version: "0.1.0",
  register(api) {
    for (const tool of tools) {
      api.registerTool(tool);
      api.logger.info("registered document tool", { name: tool.name });
    }
  },
});

export default plugin;
