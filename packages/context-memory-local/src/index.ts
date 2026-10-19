import { readdir, readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { homedir } from "node:os";
import type { ContextProvider, ContextBlock, ContextProviderContext } from "@yggdrasil/context-sdk";
import { definePlugin } from "@yggdrasil/sdk";

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function readMdDir(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile() && extname(e.name) === ".md")
      .map((e) => join(dir, e.name))
      .sort();
    const contents: string[] = [];
    for (const f of files) {
      const c = await readIfExists(f);
      if (c?.trim()) contents.push(c.trim());
    }
    return contents;
  } catch {
    return [];
  }
}

export const memoryLocalProvider: ContextProvider = {
  id: "memory-local",
  label: "Local Memory Files",
  priority: 10,

  async assemble(ctx: ContextProviderContext): Promise<ContextBlock[]> {
    const parts: string[] = [];

    const yggdrasilMd = await readIfExists(join(ctx.workspaceRoot, "YGGDRASIL.md"));
    if (yggdrasilMd?.trim()) parts.push(yggdrasilMd.trim());

    const projectMemory = await readMdDir(join(ctx.workspaceRoot, ".yggdrasil", "memory"));
    parts.push(...projectMemory);

    const globalMemory = await readMdDir(join(homedir(), ".yggdrasil", "memory"));
    parts.push(...globalMemory);

    if (parts.length === 0) return [];

    return [{
      role: "system",
      content: parts.join("\n\n---\n\n"),
      source: "memory-local",
      priority: 10,
      cacheable: true,
      ttlMs: 300_000,
    }];
  },
};

export const memoryLocalPlugin = definePlugin({
  id: "context-memory-local",
  name: "Local Memory Context",
  version: "0.1.0",
  register(api) {
    api.registerContextProvider(memoryLocalProvider);
  },
});

export default memoryLocalPlugin;
