import { describe, expect, it } from "vitest";
import type { WorktreeInfo } from "../repository/types.js";
import { closeOptions, confirmsName, defaultPrBody, defaultPrTitle, isAbandoned } from "./actions.js";

function wt(over: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    path: "/p/repo/.yggdrasil/worktrees/feat",
    head: "abc",
    branch: "ygg/feat",
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
  };
}

describe("closeOptions", () => {
  it("allows merge, PR and discard for a clean worktree with commits and nobody in it", () => {
    const o = closeOptions(wt(), "main", 0);
    expect([o.merge.allowed, o.pullRequest.allowed, o.discard.allowed]).toEqual([true, true, true]);
  });

  it("offers nothing on the main checkout", () => {
    const o = closeOptions(wt({ main: true }), "main", 0);
    expect([o.merge.allowed, o.pullRequest.allowed, o.discard.allowed]).toEqual([false, false, false]);
  });

  it("explains why merge/PR are blocked: no commits, loose changes, detached, no base", () => {
    expect(closeOptions(wt({ ahead: 0 }), "main", 0).merge.reason).toEqual({ key: "wt.reason.nothingAhead", vars: { base: "main" } });
    expect(closeOptions(wt({ changes: 1 }), "main", 0).merge.reason).toEqual({ key: "wt.reason.uncommittedOne", vars: { count: 1 } });
    expect(closeOptions(wt({ changes: 3 }), "main", 0).pullRequest.reason).toEqual({ key: "wt.reason.uncommittedMany", vars: { count: 3 } });
    expect(closeOptions(wt({ detached: true, branch: undefined }), "main", 0).merge.reason).toEqual({ key: "wt.reason.detached" });
    expect(closeOptions(wt(), undefined, 0).merge.reason).toEqual({ key: "wt.reason.noBase" });
  });

  it("never lets a worktree be discarded while an agent works in it", () => {
    expect(closeOptions(wt(), "main", 1).discard.allowed).toBe(false);
    const live = closeOptions(wt({ claudeSession: { name: "x", pid: 1, alive: true } }), "main", 0);
    expect(live.discard.allowed).toBe(false);
    expect(live.discard.reason).toEqual({ key: "wt.reason.running" });
    // A dead session left only its lock behind.
    expect(closeOptions(wt({ claudeSession: { name: "x", pid: 1, alive: false } }), "main", 0).discard.allowed).toBe(true);
  });

  it("lets a worktree whose folder is gone be cleaned up, nothing else", () => {
    const o = closeOptions(wt({ missing: true }), "main", 0);
    expect([o.merge.allowed, o.pullRequest.allowed, o.discard.allowed]).toEqual([false, false, true]);
  });

  it("keeps discard available when there is nothing to merge", () => {
    const o = closeOptions(wt({ ahead: 0 }), "main", 0);
    expect(o.discard.allowed).toBe(true);
  });
});

describe("isAbandoned", () => {
  it("flags unmerged work with nobody on it", () => {
    expect(isAbandoned(wt(), 0)).toBe(true);
    expect(isAbandoned(wt({ ahead: 0, changes: 2 }), 0)).toBe(true);
  });

  it("ignores clean, main, missing and worktrees an agent is in", () => {
    expect(isAbandoned(wt({ ahead: 0 }), 0)).toBe(false);
    expect(isAbandoned(wt({ main: true }), 0)).toBe(false);
    expect(isAbandoned(wt({ missing: true }), 0)).toBe(false);
    expect(isAbandoned(wt(), 1)).toBe(false);
    expect(isAbandoned(wt({ claudeSession: { name: "x", pid: 1, alive: true } }), 0)).toBe(false);
  });
});

describe("confirmsName / pull request text", () => {
  it("needs the exact name, ignoring surrounding spaces only", () => {
    expect(confirmsName("feat", "feat")).toBe(true);
    expect(confirmsName(" feat ", "feat")).toBe(true);
    expect(confirmsName("Feat", "feat")).toBe(false);
    expect(confirmsName("", "")).toBe(false);
  });

  it("titles a PR with the lone commit subject, else with the branch made readable", () => {
    expect(defaultPrTitle("ygg/login-fix", ["Fix login redirect"])).toBe("Fix login redirect");
    expect(defaultPrTitle("ygg/login-fix", ["a", "b"])).toBe("Login fix");
    expect(defaultPrTitle("worktree-big_refactor", [])).toBe("Big refactor");
  });

  it("lists the commit subjects as the PR body", () => {
    expect(defaultPrBody(["one", "two"])).toBe("- one\n- two");
    expect(defaultPrBody([])).toBe("");
  });
});
