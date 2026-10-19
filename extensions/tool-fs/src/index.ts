import { definePlugin } from "@yggdrasil/sdk";
import { readFileTool } from "./tools/read-file.js";
import { writeFileTool } from "./tools/write-file.js";
import { listDirTool } from "./tools/list-dir.js";
import { deleteFileTool } from "./tools/delete-file.js";
import { moveFileTool } from "./tools/move-file.js";

const plugin = definePlugin({
  id: "tool-fs",
  name: "File System",
  version: "0.1.0",
  register(api) {
    api.registerTool(readFileTool);
    api.registerTool(writeFileTool);
    api.registerTool(listDirTool);
    api.registerTool(deleteFileTool);
    api.registerTool(moveFileTool);
  },
});

export default plugin;
