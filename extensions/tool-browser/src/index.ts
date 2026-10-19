import { definePlugin } from "@yggdrasil/sdk";
import { closeAll } from "./browser-pool.js";
import { navigateTool } from "./tools/navigate.js";
import { screenshotTool } from "./tools/screenshot.js";
import { clickTool } from "./tools/click.js";
import { fillTool } from "./tools/fill.js";
import { extractTool } from "./tools/extract.js";

const plugin = definePlugin({
  id: "tool-browser",
  name: "Browser Automation",
  version: "0.1.0",
  register(api) {
    api.registerTool(navigateTool);
    api.registerTool(screenshotTool);
    api.registerTool(clickTool);
    api.registerTool(fillTool);
    api.registerTool(extractTool);

    api.registerService({
      id: "browser-pool-cleanup",
      async start() {},
      async stop() {
        await closeAll();
      },
    });
  },
});

export default plugin;
