import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContextProviderContext } from "@yggdrasil/context-sdk";
import { memoryLocalProvider } from "./index.js";

function makeCtx(workspaceRoot: string): ContextProviderContext {
  return { sessionKey: "s1", agentId: "default", workspaceRoot, config: {}, globalConfig: {} };
}

describe("memoryLocalProvider", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "memory-local-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("returns no blocks when there is nothing to read", async () => {
    const blocks = await memoryLocalProvider.assemble(makeCtx(root));
    expect(blocks).toEqual([]);
  });

  it("includes YGGDRASIL.md content from the workspace root", async () => {
    writeFileSync(join(root, "YGGDRASIL.md"), "project rules here");
    const blocks = await memoryLocalProvider.assemble(makeCtx(root));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.content).toContain("project rules here");
    expect(blocks[0]!.source).toBe("memory-local");
  });

  it("includes sorted .md files from .yggdrasil/memory", async () => {
    const memDir = join(root, ".yggdrasil", "memory");
    mkdirSync(memDir, { recursive: true });
    writeFileSync(join(memDir, "b.md"), "second");
    writeFileSync(join(memDir, "a.md"), "first");
    writeFileSync(join(memDir, "ignore.txt"), "not markdown");

    const blocks = await memoryLocalProvider.assemble(makeCtx(root));
    expect(blocks).toHaveLength(1);
    const content = blocks[0]!.content;
    expect(content.indexOf("first")).toBeLessThan(content.indexOf("second"));
    expect(content).not.toContain("not markdown");
  });
});
