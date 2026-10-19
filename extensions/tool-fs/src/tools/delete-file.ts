import { defineTool } from "@yggdrasil/tools-sdk";
import { unlink, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";

export const deleteFileTool = defineTool({
  name: "fs_delete",
  description: "Delete a file or empty directory. Set recursive=true to delete a directory and all its contents.",
  riskLevel: "destructive",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute or relative path to delete" },
      recursive: { type: "boolean", description: "Delete directory recursively (default: false)" },
    },
    required: ["path"],
  },
  async execute(ctx, args) {
    const base = ctx.workspaceRoot ?? process.cwd();
    const absPath = resolve(base, String(args.path));
    const s = await stat(absPath);
    if (s.isDirectory()) {
      await rm(absPath, { recursive: args.recursive === true, force: false });
    } else {
      await unlink(absPath);
    }
    return { path: absPath, deleted: true };
  },
});
