import { definePlugin } from "@yggdrasil/sdk";
import { createAgentTool } from "./create-agent-tool.js";
import { invokeAgentTool } from "./invoke-agent-tool.js";

const plugin = definePlugin({
  id: "tool-agents",
  name: "Agent Creation Tool",
  version: "0.4.0",
  register(api) {
    api.registerTool(createAgentTool);
    api.registerTool(invokeAgentTool);
  },
});

export default plugin;
