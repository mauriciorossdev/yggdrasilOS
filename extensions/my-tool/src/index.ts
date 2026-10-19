import { definePlugin } from "@yggdrasil/sdk";
import { defineTool } from "@yggdrasil/tools-sdk";

const exampleTool = defineTool({
  name: "my-tool_echo",
  description: "Example tool from my-tool plugin",
  parameters: {
    type: "object",
    properties: {
      message: { type: "string", description: "Text to echo" },
    },
    required: ["message"],
  },
  async execute(_ctx, args) {
    return { message: String(args.message ?? "") };
  },
});

const plugin = definePlugin({
  id: "my-tool",
  name: "my tool",
  version: "0.1.0",
  register(api) {
    api.registerTool(exampleTool);
    api.logger.info("registered tool", { name: exampleTool.name });
  },
});

export default plugin;
