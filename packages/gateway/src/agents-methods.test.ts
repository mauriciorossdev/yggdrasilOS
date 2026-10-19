import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Mock } from "vitest";

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: vi.fn() };
});

import { homedir } from "node:os";
import { mergeConfig, readGlobalAgents } from "@yggdrasil/config";
import { invokeGatewayMethod } from "./server.js";

describe("agents gateway methods", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    const home = await mkdtemp(join(tmpdir(), "ygg-home-gw-"));
    (homedir as unknown as Mock).mockReturnValue(home);
    workspaceRoot = await mkdtemp(join(tmpdir(), "ygg-ws-gw-"));
  });

  it("creates a local agent and it's immediately listed", async () => {
    const config = mergeConfig({}, { agents: [{ id: "default" }] });

    const created = (await invokeGatewayMethod(
      "agents.create",
      { id: "reviewer", label: "Reviewer", systemPrompt: "Review code.", scope: "local" },
      config,
      null,
      workspaceRoot,
    )) as { ok: boolean; agent: { id: string; scope: string } };
    expect(created.ok).toBe(true);
    expect(created.agent).toEqual({ id: "reviewer", label: "Reviewer", systemPrompt: "Review code.", scope: "local" });

    const listed = (await invokeGatewayMethod("agents.list", {}, config, null, workspaceRoot)) as {
      agents: Array<{ id: string; scope: string }>;
    };
    expect(listed.agents.some((a) => a.id === "reviewer" && a.scope === "local")).toBe(true);
  });

  it("creates a global agent visible from agents.list without touching the project file", async () => {
    const config = mergeConfig({}, { agents: [{ id: "default" }] });

    const created = (await invokeGatewayMethod(
      "agents.create",
      { id: "reviewer", systemPrompt: "Review code.", scope: "global" },
      config,
      null,
      workspaceRoot,
    )) as { ok: boolean; agent: { id: string; scope: string } };
    expect(created.agent.scope).toBe("global");

    const globalAgents = await readGlobalAgents();
    expect(globalAgents.some((a) => a.id === "reviewer")).toBe(true);

    const listed = (await invokeGatewayMethod("agents.list", {}, config, null, workspaceRoot)) as {
      agents: Array<{ id: string; scope: string }>;
    };
    expect(listed.agents.some((a) => a.id === "reviewer" && a.scope === "global")).toBe(true);
  });

  it("agents.list truncates long systemPrompt to 200 chars", async () => {
    const config = mergeConfig({}, { agents: [{ id: "default" }] });
    const longPrompt = "x".repeat(500);

    await invokeGatewayMethod(
      "agents.create",
      { id: "verbose", systemPrompt: longPrompt, scope: "local" },
      config,
      null,
      workspaceRoot,
    );

    const listed = (await invokeGatewayMethod("agents.list", {}, config, null, workspaceRoot)) as {
      agents: Array<{ id: string; systemPrompt?: string }>;
    };
    const verbose = listed.agents.find((a) => a.id === "verbose");
    expect(verbose?.systemPrompt?.length).toBe(200);
  });

  it("rejects agents.create with an invalid scope", async () => {
    const config = mergeConfig({}, { agents: [{ id: "default" }] });
    await expect(
      invokeGatewayMethod("agents.create", { id: "x", scope: "nowhere" }, config, null, workspaceRoot),
    ).rejects.toThrow(/scope must be/);
  });

  it("deletes a local agent and it's no longer listed", async () => {
    const config = mergeConfig({}, { agents: [{ id: "default" }] });
    await invokeGatewayMethod(
      "agents.create",
      { id: "reviewer", scope: "local" },
      config,
      null,
      workspaceRoot,
    );

    const deleted = (await invokeGatewayMethod(
      "agents.delete",
      { id: "reviewer", scope: "local" },
      config,
      null,
      workspaceRoot,
    )) as { ok: boolean };
    expect(deleted.ok).toBe(true);

    const listed = (await invokeGatewayMethod("agents.list", {}, config, null, workspaceRoot)) as {
      agents: Array<{ id: string }>;
    };
    expect(listed.agents.some((a) => a.id === "reviewer")).toBe(false);
  });

  it("deletes a global agent without touching the project file", async () => {
    const config = mergeConfig({}, { agents: [{ id: "default" }] });
    await invokeGatewayMethod(
      "agents.create",
      { id: "reviewer", scope: "global" },
      config,
      null,
      workspaceRoot,
    );

    await invokeGatewayMethod("agents.delete", { id: "reviewer", scope: "global" }, config, null, workspaceRoot);

    const globalAgents = await readGlobalAgents();
    expect(globalAgents.some((a) => a.id === "reviewer")).toBe(false);
  });

  it("rejects agents.delete for an unknown agent", async () => {
    const config = mergeConfig({}, { agents: [{ id: "default" }] });
    await expect(
      invokeGatewayMethod("agents.delete", { id: "ghost", scope: "local" }, config, null, workspaceRoot),
    ).rejects.toThrow(/not found/);
  });
});
