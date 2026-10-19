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
import { readGlobalAgents, writeGlobalAgents, mergeAgentSources, resolveGlobalAgentsPath } from "./global-agents.js";

describe("global agents storage", () => {
  beforeEach(async () => {
    const root = await mkdtemp(join(tmpdir(), "ygg-home-"));
    (homedir as unknown as Mock).mockReturnValue(root);
  });

  it("returns an empty array when the file doesn't exist", async () => {
    expect(await readGlobalAgents()).toEqual([]);
  });

  it("writes and reads back agents", async () => {
    await writeGlobalAgents([{ id: "reviewer", label: "Reviewer" }]);
    const agents = await readGlobalAgents();
    expect(agents).toEqual([{ id: "reviewer", label: "Reviewer" }]);
  });

  it("creates ~/.yggdrasil if missing", async () => {
    const path = await writeGlobalAgents([{ id: "a" }]);
    expect(path).toBe(resolveGlobalAgentsPath());
  });

  it("degrades gracefully on malformed JSON", async () => {
    await writeGlobalAgents([{ id: "a" }]);
    // Overwrite with garbage via the same path resolution.
    const { writeFile } = await import("node:fs/promises");
    await writeFile(resolveGlobalAgentsPath(), "not json", "utf8");
    expect(await readGlobalAgents()).toEqual([]);
  });
});

describe("mergeAgentSources", () => {
  it("concatenates local and global with scope tags", () => {
    const result = mergeAgentSources([{ id: "default" }], [{ id: "reviewer" }]);
    expect(result).toEqual([
      { id: "default", scope: "local" },
      { id: "reviewer", scope: "global" },
    ]);
  });

  it("local wins on id collision, global entry dropped", () => {
    const result = mergeAgentSources(
      [{ id: "shared", label: "Local Version" }],
      [{ id: "shared", label: "Global Version" }],
    );
    expect(result).toEqual([{ id: "shared", label: "Local Version", scope: "local" }]);
  });

  it("handles empty arrays on either side", () => {
    expect(mergeAgentSources([], [])).toEqual([]);
    expect(mergeAgentSources([{ id: "a" }], [])).toEqual([{ id: "a", scope: "local" }]);
    expect(mergeAgentSources([], [{ id: "b" }])).toEqual([{ id: "b", scope: "global" }]);
  });
});
