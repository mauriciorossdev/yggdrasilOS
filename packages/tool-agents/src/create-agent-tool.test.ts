import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Mock } from "vitest";

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: vi.fn() };
});

vi.mock("@yggdrasil/kernel", () => ({
  getKernelContext: vi.fn(),
}));

import { homedir } from "node:os";
import { getKernelContext } from "@yggdrasil/kernel";
import { createAgentTool } from "./create-agent-tool.js";

describe("create_agent tool", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    const home = await mkdtemp(join(tmpdir(), "ygg-home-tool-"));
    (homedir as unknown as Mock).mockReturnValue(home);
    workspaceRoot = await mkdtemp(join(tmpdir(), "ygg-ws-tool-"));
    (getKernelContext as unknown as Mock).mockReturnValue({ workspaceRoot, config: {}, state: "running" });
  });

  it("declares itself destructive and therefore approval-required", () => {
    expect(createAgentTool.riskLevel).toBe("destructive");
    expect(createAgentTool.requiresApproval).toBe(true);
  });

  it("rejects a missing id", async () => {
    await expect(
      createAgentTool.execute({ sessionKey: "s", config: {} }, { systemPrompt: "x", scope: "local" }),
    ).rejects.toThrow(/id is required/);
  });

  it("rejects a missing systemPrompt", async () => {
    await expect(
      createAgentTool.execute({ sessionKey: "s", config: {} }, { id: "reviewer", scope: "local" }),
    ).rejects.toThrow(/systemPrompt is required/);
  });

  it("rejects an invalid scope", async () => {
    await expect(
      createAgentTool.execute(
        { sessionKey: "s", config: {} },
        { id: "reviewer", systemPrompt: "x", scope: "sometimes" },
      ),
    ).rejects.toThrow(/scope must be exactly/);
  });

  it("creates a local agent using the kernel's workspaceRoot", async () => {
    const result = (await createAgentTool.execute(
      { sessionKey: "s", config: {} },
      { id: "reviewer", label: "Reviewer", systemPrompt: "Review code.", scope: "local" },
    )) as { created: boolean; id: string; scope: string };

    expect(result).toEqual({
      created: true,
      id: "reviewer",
      scope: "local",
      note: expect.any(String),
    });

    const raw = JSON.parse(await readFile(join(workspaceRoot, "yggdrasil.config.json"), "utf8")) as {
      agents: Array<{ id: string }>;
    };
    expect(raw.agents.some((a) => a.id === "reviewer")).toBe(true);
  });
});
