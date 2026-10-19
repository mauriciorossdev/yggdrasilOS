import { defineTool } from "@yggdrasil/tools-sdk";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const readFileTool = defineTool({
  name: "fs_read_file",
  description:
    "Read the contents of a file. Returns text content. Use offset/limit to read large files in chunks.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute or relative path to the file" },
      offset: { type: "number", description: "Line number to start from (1-based, default: 1)" },
      limit: { type: "number", description: "Maximum number of lines to return (default: 200)" },
    },
    required: ["path"],
  },
  async execute(ctx, args) {
    const base = ctx.workspaceRoot ?? process.cwd();
    const absPath = resolve(base, String(args.path));
    const raw = await readFile(absPath, "utf-8");
    const lines = raw.split("\n");
    const offset = typeof args.offset === "number" ? Math.max(1, args.offset) : 1;
    const limit = typeof args.limit === "number" ? args.limit : 200;
    const slice = lines.slice(offset - 1, offset - 1 + limit);
    return {
      path: absPath,
      content: slice.join("\n"),
      totalLines: lines.length,
      returnedLines: slice.length,
      offset,
    };
  },
});
