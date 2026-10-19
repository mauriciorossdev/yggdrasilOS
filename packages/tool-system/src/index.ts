import { definePlugin } from "@yggdrasil/sdk";
import { systemInfoTool } from "./system-info.js";
import { listDirectoryTool, readFileTool, writeFileTool } from "./filesystem.js";
import { listProcessesTool, listInstalledAppsTool } from "./processes.js";
import { runCommandTool } from "./shell.js";
import { openPathTool } from "./open-path.js";
import { listDesktopProjectsTool, openDesktopProjectTool } from "./open-desktop.js";
import { getWeatherTool } from "./weather.js";

const tools = [
  systemInfoTool,
  listDirectoryTool,
  readFileTool,
  writeFileTool,
  listProcessesTool,
  listInstalledAppsTool,
  runCommandTool,
  openPathTool,
  listDesktopProjectsTool,
  openDesktopProjectTool,
  getWeatherTool,
];

const plugin = definePlugin({
  id: "tool-system",
  name: "System Tools",
  version: "0.1.0",
  register(api) {
    for (const tool of tools) {
      api.registerTool(tool);
      api.logger.info("registered system tool", { name: tool.name });
    }
  },
});

export default plugin;
