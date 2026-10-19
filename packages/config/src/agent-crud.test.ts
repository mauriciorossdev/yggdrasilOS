import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Mock } from "vitest";

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: vi.fn() };
});

import { homedir } from "node:os";
import { createAgent, deleteAgent, updateAgent } from "./agent-crud.js";
import { readGlobalAgents } from "./global-agents.js";
import { writeConfigFile } from "./file.js";

describe("createAgent", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    const home = await mkdtemp(join(tmpdir(), "ygg-home-"));
    (homedir as unknown as Mock).mockReturnValue(home);
    workspaceRoot = await mkdtemp(join(tmpdir(), "ygg-ws-"));
  });

  it("writes a local agent into the project config file", async () => {
    const result = await createAgent({
      agent: { id: "reviewer", label: "Reviewer", systemPrompt: "Review code." },
      scope: "local",
      workspaceRoot,
    });
    expect(result).toEqual({ id: "reviewer", label: "Reviewer", systemPrompt: "Review code.", scope: "local" });

    const raw = JSON.parse(await readFile(join(workspaceRoot, "yggdrasil.config.json"), "utf8")) as {
      agents: Array<{ id: string }>;
    };
    expect(raw.agents.some((a) => a.id === "reviewer")).toBe(true);
    expect(await readGlobalAgents()).toEqual([]);
  });

  it("writes a global agent without touching the project file", async () => {
    await writeConfigFile(workspaceRoot, { agents: [{ id: "default" }] });

    const result = await createAgent({
      agent: { id: "reviewer", systemPrompt: "Review code." },
      scope: "global",
      workspaceRoot,
    });
    expect(result.scope).toBe("global");

    const globalAgents = await readGlobalAgents();
    expect(globalAgents).toEqual([{ id: "reviewer", systemPrompt: "Review code." }]);

    const raw = JSON.parse(await readFile(join(workspaceRoot, "yggdrasil.config.json"), "utf8")) as {
      agents: Array<{ id: string }>;
    };
    expect(raw.agents).toEqual([{ id: "default" }]);
  });

  it("rejects a duplicate id in the same scope", async () => {
    await createAgent({ agent: { id: "reviewer" }, scope: "local", workspaceRoot });
    await expect(createAgent({ agent: { id: "reviewer" }, scope: "local", workspaceRoot })).rejects.toThrow(
      /already exists in local scope/,
    );
  });

  it("rejects creating a local agent that collides with an existing global one", async () => {
    await createAgent({ agent: { id: "reviewer" }, scope: "global", workspaceRoot });
    await expect(createAgent({ agent: { id: "reviewer" }, scope: "local", workspaceRoot })).rejects.toThrow(
      /already exists in global scope/,
    );
  });

  it("requires workspaceRoot for local scope", async () => {
    await expect(createAgent({ agent: { id: "reviewer" }, scope: "local" })).rejects.toThrow(/workspaceRoot/);
  });

  it("rejects an empty id", async () => {
    await expect(createAgent({ agent: { id: "  " }, scope: "global" })).rejects.toThrow(/id is required/);
  });

  it("rejects an invalid scope", async () => {
    await expect(
      createAgent({ agent: { id: "x" }, scope: "nope" as unknown as "local", workspaceRoot }),
    ).rejects.toThrow(/scope must be/);
  });
});

describe("updateAgent", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    const home = await mkdtemp(join(tmpdir(), "ygg-home-"));
    (homedir as unknown as Mock).mockReturnValue(home);
    workspaceRoot = await mkdtemp(join(tmpdir(), "ygg-ws-"));
  });

  it("edits a local agent in place, leaving other agents untouched", async () => {
    await createAgent({ agent: { id: "reviewer", label: "Reviewer", systemPrompt: "old" }, scope: "local", workspaceRoot });
    await createAgent({ agent: { id: "other" }, scope: "local", workspaceRoot });

    const result = await updateAgent({
      agent: { id: "reviewer", label: "Reviewer v2", systemPrompt: "new prompt" },
      scope: "local",
      workspaceRoot,
    });
    expect(result).toEqual({ id: "reviewer", label: "Reviewer v2", systemPrompt: "new prompt", scope: "local" });

    const raw = JSON.parse(await readFile(join(workspaceRoot, "yggdrasil.config.json"), "utf8")) as {
      agents: Array<{ id: string; label?: string; systemPrompt?: string }>;
    };
    expect(raw.agents.find((a) => a.id === "reviewer")).toEqual({
      id: "reviewer",
      label: "Reviewer v2",
      systemPrompt: "new prompt",
    });
    expect(raw.agents.find((a) => a.id === "other")).toEqual({ id: "other" });
  });

  it("edits a global agent in place", async () => {
    await createAgent({ agent: { id: "reviewer", label: "Old" }, scope: "global", workspaceRoot });

    const result = await updateAgent({ agent: { id: "reviewer", label: "New" }, scope: "global", workspaceRoot });
    expect(result).toEqual({ id: "reviewer", label: "New", scope: "global" });
    expect(await readGlobalAgents()).toEqual([{ id: "reviewer", label: "New" }]);
  });

  it("rejects updating an agent that doesn't exist in that scope", async () => {
    await expect(updateAgent({ agent: { id: "ghost" }, scope: "local", workspaceRoot })).rejects.toThrow(
      /not found in local scope/,
    );
  });

  it("requires workspaceRoot for local scope", async () => {
    await expect(updateAgent({ agent: { id: "reviewer" }, scope: "local" })).rejects.toThrow(/workspaceRoot/);
  });

  it("rejects an empty id", async () => {
    await expect(updateAgent({ agent: { id: "  " }, scope: "global" })).rejects.toThrow(/id is required/);
  });

  it("rejects an invalid scope", async () => {
    await expect(
      updateAgent({ agent: { id: "x" }, scope: "nope" as unknown as "local", workspaceRoot }),
    ).rejects.toThrow(/scope must be/);
  });
});

describe("deleteAgent", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    const home = await mkdtemp(join(tmpdir(), "ygg-home-"));
    (homedir as unknown as Mock).mockReturnValue(home);
    workspaceRoot = await mkdtemp(join(tmpdir(), "ygg-ws-"));
  });

  it("removes a local agent, leaving other agents untouched", async () => {
    await createAgent({ agent: { id: "reviewer" }, scope: "local", workspaceRoot });
    await createAgent({ agent: { id: "other" }, scope: "local", workspaceRoot });

    await deleteAgent({ id: "reviewer", scope: "local", workspaceRoot });

    const raw = JSON.parse(await readFile(join(workspaceRoot, "yggdrasil.config.json"), "utf8")) as {
      agents: Array<{ id: string }>;
    };
    expect(raw.agents.some((a) => a.id === "reviewer")).toBe(false);
    expect(raw.agents.some((a) => a.id === "other")).toBe(true);
  });

  it("removes a global agent without touching the project file", async () => {
    await writeConfigFile(workspaceRoot, { agents: [{ id: "default" }] });
    await createAgent({ agent: { id: "reviewer" }, scope: "global", workspaceRoot });

    await deleteAgent({ id: "reviewer", scope: "global", workspaceRoot });

    expect(await readGlobalAgents()).toEqual([]);
    const raw = JSON.parse(await readFile(join(workspaceRoot, "yggdrasil.config.json"), "utf8")) as {
      agents: Array<{ id: string }>;
    };
    expect(raw.agents).toEqual([{ id: "default" }]);
  });

  it("rejects deleting an agent that doesn't exist in that scope", async () => {
    await expect(deleteAgent({ id: "ghost", scope: "local", workspaceRoot })).rejects.toThrow(
      /not found in local scope/,
    );
  });

  it("requires workspaceRoot for local scope", async () => {
    await expect(deleteAgent({ id: "reviewer", scope: "local" })).rejects.toThrow(/workspaceRoot/);
  });

  it("rejects an empty id", async () => {
    await expect(deleteAgent({ id: "  ", scope: "global" })).rejects.toThrow(/id is required/);
  });

  it("rejects an invalid scope", async () => {
    await expect(
      deleteAgent({ id: "x", scope: "nope" as unknown as "local", workspaceRoot }),
    ).rejects.toThrow(/scope must be/);
  });
});
