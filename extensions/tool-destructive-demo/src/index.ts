import { definePlugin } from "@yggdrasil/sdk";
import { defineTool } from "@yggdrasil/tools-sdk";

const deleteFileTool = defineTool({
  name: "delete_file",
  description: "Demo destructive tool — simulates file deletion but does not actually delete anything. Requires user approval.",
  riskLevel: "destructive",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to (pretend to) delete" },
    },
    required: ["path"],
  },
  async execute(_ctx, args) {
    return { deleted: false, demo: true, path: String(args.path ?? "") };
  },
});

const plugin = definePlugin({
  id: "tool-destructive-demo",
  name: "Destructive Tool Demo",
  version: "0.1.0",
  register(api) {
    api.registerTool(deleteFileTool);
    api.logger.info("registered destructive demo tool", { name: deleteFileTool.name });
  },
});

export default plugin;
