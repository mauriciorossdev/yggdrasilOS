import { defineTool } from "@yggdrasil/tools-sdk";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";

export const writeFileTool = defineTool({
  name: "fs_write_file",
  description: "Write or overwrite a file with the given content. Creates parent directories if needed.",
  riskLevel: "destructive",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute or relative path to the file" },
      content: { type: "string", description: "Content to write" },
    },
    required: ["path", "content"],
  },
  async execute(ctx, args) {
    const base = ctx.workspaceRoot ?? process.cwd();
    const absPath = resolve(base, String(args.path));
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, String(args.content), "utf-8");
    return { path: absPath, written: true, bytes: Buffer.byteLength(String(args.content), "utf-8") };
  },
});
