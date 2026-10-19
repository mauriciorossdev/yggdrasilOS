import { readdir, readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import type { ContextProvider, ContextBlock, ContextProviderContext } from "@yggdrasil/context-sdk";
import { definePlugin } from "@yggdrasil/sdk";

async function findMdFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && extname(e.name) === ".md")
      .map((e) => join(dir, e.name))
      .sort();
  } catch {
    return [];
  }
}

export const promptFilesProvider: ContextProvider = {
  id: "prompt-files",
  label: "Prompt Files",
  priority: 0,

  async assemble(ctx: ContextProviderContext): Promise<ContextBlock[]> {
    const cfg = ctx.config as { paths?: string[] } | undefined;
    const dirs = cfg?.paths ?? ["prompts"];
    const allContents: string[] = [];

    for (const dir of dirs) {
      const fullDir = join(ctx.workspaceRoot, dir);
      const files = await findMdFiles(fullDir);
      for (const file of files) {
        try {
          const content = await readFile(file, "utf8");
          if (content.trim()) allContents.push(content.trim());
        } catch {
          // skip unreadable
        }
      }
    }

    if (allContents.length === 0) return [];

    return [{
      role: "system",
      content: allContents.join("\n\n---\n\n"),
      source: "prompt-files",
      priority: 0,
      cacheable: true,
      ttlMs: 300_000,
    }];
  },
};

export const promptFilesPlugin = definePlugin({
  id: "context-prompt-files",
  name: "Prompt Files Context",
  version: "0.1.0",
  register(api) {
    api.registerContextProvider(promptFilesProvider);
  },
});

export default promptFilesPlugin;
