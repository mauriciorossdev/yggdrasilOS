import { definePlugin } from "@yggdrasil/sdk";
import { desktopTools } from "./tools.js";

const plugin = definePlugin({
  id: "tool-desktop",
  name: "Desktop Automation Tools",
  version: "0.1.0",
  register(api) {
    for (const tool of desktopTools) {
      api.registerTool(tool);
      api.logger.info("registered desktop tool", { name: tool.name });
    }
  },
});

export default plugin;
