import type { WorktreeInfo } from "../repository/types.js";
import type { Msg } from "./status.js";

export type CloseOptions = {
  /** Merge the branch into the base checkout. */
  merge: { allowed: boolean; reason?: Msg };
  /** Push the branch and open a pull request. */
  pullRequest: { allowed: boolean; reason?: Msg };
  /** Remove the worktree and its branch, dropping whatever isn't merged. */
  discard: { allowed: boolean; reason?: Msg };
};

const NONE = { allowed: false } as const;

/**
 * What can be done to close a worktree, from git's view of it and from whether an agent is still
 * working in it (`livePanes`: panes whose folder is this worktree or whose process is its Claude lock).
 */
export function closeOptions(w: WorktreeInfo, base: string | undefined, livePanes: number): CloseOptions {
  if (w.main || w.bare) return { merge: NONE, pullRequest: NONE, discard: NONE };

  const running = w.claudeSession?.alive === true;
  const discard =
    running || livePanes > 0
      ? { allowed: false, reason: { key: "wt.reason.running" } satisfies Msg }
      : { allowed: true };
  if (w.missing) return { merge: NONE, pullRequest: NONE, discard };

  const hasBranch = Boolean(w.branch) && !w.detached;
  const noBranch = { allowed: false, reason: { key: "wt.reason.detached" } satisfies Msg };
  const nothingAhead = {
    allowed: false,
    reason: (base ? { key: "wt.reason.nothingAhead", vars: { base } } : { key: "wt.reason.nothingAheadNoBase" }) satisfies Msg,
  };

  if (!hasBranch) return { merge: noBranch, pullRequest: noBranch, discard };
  if (!base) {
    const noBase = { allowed: false, reason: { key: "wt.reason.noBase" } satisfies Msg };
    return { merge: noBase, pullRequest: noBase, discard };
  }
  if (w.ahead === 0) return { merge: nothingAhead, pullRequest: nothingAhead, discard };

  // A merge or a PR carries commits only: loose changes would be left behind unnoticed.
  const uncommitted = {
    allowed: false,
    reason: { key: w.changes === 1 ? "wt.reason.uncommittedOne" : "wt.reason.uncommittedMany", vars: { count: w.changes } } satisfies Msg,
  };
  if (w.changes > 0) return { merge: uncommitted, pullRequest: uncommitted, discard };
  return { merge: { allowed: true }, pullRequest: { allowed: true }, discard };
}

/** Work that exists only here, with nobody working on it: worth a reminder. */
export function isAbandoned(w: WorktreeInfo, livePanes: number): boolean {
  if (w.main || w.bare || w.missing) return false;
  if (w.claudeSession?.alive || livePanes > 0) return false;
  return w.ahead > 0 || w.changes > 0;
}

/** The discard dialog unlocks only when the exact name is typed. */
export function confirmsName(typed: string, name: string): boolean {
  return name.trim() !== "" && typed.trim() === name;
}

/** Pull request title: the lone commit's subject, else the branch name made readable. */
export function defaultPrTitle(branch: string, subjects: string[]): string {
  if (subjects.length === 1) return subjects[0]!;
  const words = branch.replace(/^ygg\//, "").replace(/^worktree-/, "").replace(/[-_]+/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : branch;
}

/** Pull request body: what the branch adds, newest commit first as git log gives it. */
export function defaultPrBody(subjects: string[]): string {
  return subjects.length === 0 ? "" : subjects.map((s) => `- ${s}`).join("\n");
}
