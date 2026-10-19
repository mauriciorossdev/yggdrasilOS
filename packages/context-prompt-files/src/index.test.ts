import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContextProviderContext } from "@yggdrasil/context-sdk";
import { promptFilesProvider } from "./index.js";

function makeCtx(workspaceRoot: string, config?: unknown): ContextProviderContext {
  return { sessionKey: "s1", agentId: "default", workspaceRoot, config, globalConfig: {} };
}

describe("promptFilesProvider", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "prompt-files-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("returns no blocks when the default 'prompts' dir does not exist", async () => {
    const blocks = await promptFilesProvider.assemble(makeCtx(root));
    expect(blocks).toEqual([]);
  });

  it("reads .md files from the default 'prompts' dir", async () => {
    const dir = join(root, "prompts");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "system.md"), "you are a helpful agent");

    const blocks = await promptFilesProvider.assemble(makeCtx(root));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.content).toContain("you are a helpful agent");
    expect(blocks[0]!.source).toBe("prompt-files");
  });

  it("reads from custom paths given in config", async () => {
    const dir = join(root, "custom-prompts");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "a.md"), "custom content");

    const blocks = await promptFilesProvider.assemble(makeCtx(root, { paths: ["custom-prompts"] }));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.content).toContain("custom content");
  });
});
