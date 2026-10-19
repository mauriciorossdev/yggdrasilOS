import { defineTool } from "@yggdrasil/tools-sdk";
import { rename, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";

export const moveFileTool = defineTool({
  name: "fs_move",
  description: "Move or rename a file or directory.",
  riskLevel: "moderate",
  parameters: {
    type: "object",
    properties: {
      from: { type: "string", description: "Source path" },
      to: { type: "string", description: "Destination path" },
    },
    required: ["from", "to"],
  },
  async execute(ctx, args) {
    const base = ctx.workspaceRoot ?? process.cwd();
    const src = resolve(base, String(args.from));
    const dst = resolve(base, String(args.to));
    await mkdir(dirname(dst), { recursive: true });
    await rename(src, dst);
    return { from: src, to: dst, moved: true };
  },
});
