import { describe, expect, it } from "vitest";
import type { WorktreeInfo } from "../repository/types.js";
import { baseChanges, bulkGroup, runBulkMerge, runBulkRemove, type BulkItem, type Step } from "./bulk.js";

const wt = (over: Partial<WorktreeInfo> = {}): WorktreeInfo => ({
  path: "/p/.yggdrasil/worktrees/a",
  head: "abc",
  branch: "ygg/a",
  detached: false,
  bare: false,
  locked: false,
  prunable: false,
  main: false,
  origin: "app",
  changes: 0,
  ahead: 2,
  missing: false,
  ...over,
});

describe("bulkGroup", () => {
  const idle = [{ id: "p1" }];
  it("ready: commits ahead, nothing uncommitted, nobody working (idle panes are fine)", () => {
    expect(bulkGroup(wt(), "main", idle, { p1: { status: "done", since: 1 } })).toEqual({ group: "ready" });
    expect(bulkGroup(wt(), "main", [], {})).toEqual({ group: "ready" });
  });

  it("busy: an agent working or waiting, a Claude session outside the app, uncommitted changes, no branch", () => {
    expect(bulkGroup(wt(), "main", idle, { p1: { status: "working", since: 1 } })?.group).toBe("busy");
    expect(bulkGroup(wt(), "main", idle, { p1: { status: "waiting", since: 1 } })?.group).toBe("busy");
    expect(bulkGroup(wt({ claudeSession: { name: "x", pid: 1, alive: true } }), "main", [], {})?.reason?.key).toBe("wt.bulk.reasonOutside");
    expect(bulkGroup(wt({ changes: 3 }), "main", [], {})?.reason).toEqual({ key: "wt.reason.uncommittedMany", vars: { count: 3 } });
    expect(bulkGroup(wt({ detached: true, branch: undefined }), "main", [], {})?.group).toBe("busy");
    expect(bulkGroup(wt(), undefined, [], {})?.group).toBe("busy");
  });

  it("empty: nothing ahead and nothing uncommitted, or the folder is gone; the main checkout is in no group", () => {
    expect(bulkGroup(wt({ ahead: 0 }), "main", idle, {})?.group).toBe("empty");
    expect(bulkGroup(wt({ missing: true, changes: 4 }), "main", [], {})?.group).toBe("empty");
    expect(bulkGroup(wt({ main: true }), "main", [], {})).toBeNull();
  });
});

function fakeCall(conflicts: Set<string>, failRemove = new Set<string>()) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const call = async <T,>(method: string, params: Record<string, unknown>): Promise<T> => {
    calls.push([method, params]);
    if (method === "git.merge" && !params.abort) {
      return (conflicts.has(String(params.branch)) ? { ok: false, conflicts: true, output: "CONFLICT x" } : { ok: true, conflicts: false }) as T;
    }
    if (method === "git.worktreeRemove" && failRemove.has(String(params.path))) throw new Error("git.worktreeRemove: locked");
    if (method === "git.status2") return { changes: [{ kind: "untracked" }, { kind: "changed" }] } as T;
    return { ok: true } as T;
  };
  return { call, calls };
}

const item = (name: string, paneIds: string[] = []): BulkItem => ({
  worktree: wt({ path: `/p/wt/${name}`, branch: `ygg/${name}` }),
  name,
  paneIds,
});

describe("runBulkMerge", () => {
  it("merges in order, aborts a conflict and goes on, removes merged ones with their panes and comments", async () => {
    const { call, calls } = fakeCall(new Set(["ygg/b"]));
    const closed: string[][] = [];
    const dropped: string[] = [];
    const snapshots: Step[][] = [];
    const steps = await runBulkMerge(
      {
        call,
        repo: ".",
        closePanes: async (ids) => void closed.push(ids),
        dropComments: async (p) => void dropped.push(p),
        onStep: (s) => snapshots.push(s),
      },
      [item("a", ["p1"]), item("b", ["p2"]), item("c")],
      { removeAfter: true, closePanes: true },
    );
    expect(steps.map((s) => s.state)).toEqual(["removed", "conflict", "removed"]);
    expect(steps[1]!.detail).toBe("CONFLICT x");
    expect(calls.filter(([m]) => m === "git.merge").map(([, p]) => p.branch ?? "abort")).toEqual(["ygg/a", "ygg/b", "abort", "ygg/c"]);
    expect(closed).toEqual([["p1"]]);
    expect(dropped).toEqual(["/p/wt/a", "/p/wt/c"]);
    expect(snapshots.some((s) => s[0]!.state === "running")).toBe(true);
  });

  it("without removeAfter only merges; a failed cleanup still says merged", async () => {
    const { call, calls } = fakeCall(new Set(), new Set(["/p/wt/a"]));
    const deps = { call, repo: ".", closePanes: async () => {}, dropComments: async () => {}, onStep: () => {} };
    expect((await runBulkMerge(deps, [item("a")], { removeAfter: false, closePanes: true })).map((s) => s.state)).toEqual(["merged"]);
    expect(calls.some(([m]) => m === "git.worktreeRemove")).toBe(false);
    const res = await runBulkMerge(deps, [item("a")], { removeAfter: true, closePanes: true });
    expect(res[0]).toMatchObject({ state: "merged", detail: "locked" });
  });
});

describe("runBulkRemove / baseChanges", () => {
  it("removes each without force and keeps going after an error", async () => {
    const { call, calls } = fakeCall(new Set(), new Set(["/p/wt/a"]));
    const steps = await runBulkRemove(
      { call, repo: ".", closePanes: async () => {}, dropComments: async () => {}, onStep: () => {} },
      [item("a"), item("b")],
      { closePanes: false },
    );
    expect(steps.map((s) => s.state)).toEqual(["error", "removed"]);
    expect(calls.filter(([m]) => m === "git.worktreeRemove").every(([, p]) => p.force === undefined && p.deleteBranch === true)).toBe(true);
  });

  it("counts only tracked changes in the base checkout", async () => {
    expect(await baseChanges(fakeCall(new Set()).call, ".")).toBe(1);
  });
});
