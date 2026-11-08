import { describe, expect, it } from "vitest";
import type { WorktreeInfo } from "../repository/types.js";
import { worktreeState } from "./status.js";

const base: WorktreeInfo = {
  path: "/p/a",
  head: "abc",
  branch: "ygg/a",
  detached: false,
  bare: false,
  locked: false,
  prunable: false,
  main: false,
  origin: "app",
  changes: 0,
  ahead: 0,
  missing: false,
};

describe("worktreeState", () => {
  it("prefers a live Claude session over everything but a missing folder", () => {
    const w = { ...base, changes: 3, claudeSession: { name: "a", pid: 1, alive: true } };
    expect(worktreeState(w).key).toBe("active");
    expect(worktreeState({ ...w, missing: true }).key).toBe("missing");
  });
  it("ignores a stale Claude lock", () => {
    expect(worktreeState({ ...base, claudeSession: { name: "a", pid: 1, alive: false } }).key).toBe("clean");
  });
  it("reports changes, then commits ahead, then clean", () => {
    expect(worktreeState({ ...base, changes: 2, ahead: 1 })).toMatchObject({ key: "dirty", label: { key: "wt.state.dirty", vars: { count: 2 } } });
    expect(worktreeState({ ...base, ahead: 4 })).toMatchObject({ key: "ahead", label: { key: "wt.state.ahead", vars: { count: 4 } } });
    expect(worktreeState(base).key).toBe("clean");
  });
});
