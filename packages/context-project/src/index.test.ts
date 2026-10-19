import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContextProviderContext } from "@yggdrasil/context-sdk";
import { projectContextProvider } from "./index.js";

function makeCtx(workspaceRoot: string): ContextProviderContext {
  return { sessionKey: "s1", agentId: "default", workspaceRoot, config: {}, globalConfig: {} };
}

describe("projectContextProvider", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "project-ctx-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("reports 'not a git repo' and detected package manager/name for a plain directory", async () => {
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "my-fixture-app" }));
    writeFileSync(join(root, "pnpm-lock.yaml"), "");

    const blocks = await projectContextProvider.assemble(makeCtx(root));

    expect(blocks).toHaveLength(1);
    const content = blocks[0]!.content;
    expect(content).toContain("not a git repo");
    expect(content).toContain("my-fixture-app");
    expect(content).toContain("pnpm");
    expect(content).toContain("JavaScript/Node");
    expect(blocks[0]!.source).toBe("project-context");
  });

  it("falls back to the directory name when there is no package.json", async () => {
    const blocks = await projectContextProvider.assemble(makeCtx(root));
    const content = blocks[0]!.content;
    expect(content).toContain(root.split("/").pop()!);
    expect(content).toContain("Package manager: unknown");
  });
});
