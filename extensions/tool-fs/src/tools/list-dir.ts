import { defineTool } from "@yggdrasil/tools-sdk";
import { readdir, stat } from "node:fs/promises";
import { resolve, join } from "node:path";

export const listDirTool = defineTool({
  name: "fs_list_dir",
  description: "List files and directories at a path. Optionally recursive up to a max depth.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory path to list" },
      recursive: { type: "boolean", description: "List recursively (default: false)" },
      maxDepth: { type: "number", description: "Max recursion depth when recursive=true (default: 3)" },
    },
    required: ["path"],
  },
  async execute(ctx, args) {
    const base = ctx.workspaceRoot ?? process.cwd();
    const absPath = resolve(base, String(args.path));
    const recursive = args.recursive === true;
    const maxDepth = typeof args.maxDepth === "number" ? args.maxDepth : 3;

    const entries: Array<{ path: string; type: "file" | "dir"; size?: number }> = [];

    async function walk(dir: string, depth: number) {
      if (depth > maxDepth) return;
      const items = await readdir(dir);
      for (const item of items) {
        const full = join(dir, item);
        const s = await stat(full);
        const rel = full.slice(absPath.length + 1);
        if (s.isDirectory()) {
          entries.push({ path: rel, type: "dir" });
          if (recursive) await walk(full, depth + 1);
        } else {
          entries.push({ path: rel, type: "file", size: s.size });
        }
      }
    }

    await walk(absPath, 0);
    return { path: absPath, entries, count: entries.length };
  },
});
