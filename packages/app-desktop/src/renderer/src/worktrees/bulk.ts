import type { WorktreeInfo } from "../repository/types.js";
import type { PaneAttention } from "../types.js";
import { closeOptions } from "./actions.js";
import type { Msg } from "./status.js";

/**
 * Bulk actions on worktrees (notes/features/worktree-bulk-actions.md): which
 * ones can be merged or removed together, and running a batch one worktree at
 * a time over the gateway's existing git.* methods.
 */

export type BulkGroup = "ready" | "empty" | "busy";
export type Grouped = { group: BulkGroup; reason?: Msg };
type Pane = { id: string };

/** Panes of this worktree whose agent is mid-turn or waiting for an answer. */
function busyPanes(panes: Pane[], attention: Record<string, PaneAttention>): Pane[] {
  return panes.filter((p) => attention[p.id]?.status === "working" || attention[p.id]?.status === "waiting");
}

/**
 * - ready: can be merged into the base (commits ahead, nothing uncommitted), nobody working in it.
 * - empty: nothing would be lost by removing it (nothing ahead, nothing uncommitted, or its folder is gone).
 * - busy: everything else, with the reason.
 * The main checkout (and a bare repo) is in no group: null.
 */
export function bulkGroup(
  w: WorktreeInfo,
  base: string | undefined,
  panes: Pane[],
  attention: Record<string, PaneAttention>,
): Grouped | null {
  if (w.main || w.bare) return null;
  if (busyPanes(panes, attention).length > 0) return { group: "busy", reason: { key: "wt.bulk.reasonWorking" } };
  // A Claude session holding the worktree that isn't a pane of this app can't be closed from here.
  if (w.claudeSession?.alive && panes.length === 0) return { group: "busy", reason: { key: "wt.bulk.reasonOutside" } };
  if (w.missing) return { group: "empty", reason: { key: "wt.bulk.reasonMissing" } };
  if (w.changes > 0) {
    return {
      group: "busy",
      reason: { key: w.changes === 1 ? "wt.reason.uncommittedOne" : "wt.reason.uncommittedMany", vars: { count: w.changes } },
    };
  }
  if (w.ahead === 0) return { group: "empty", reason: { key: "wt.bulk.reasonNothingAhead" } };
  // Panes don't block a merge here: they're idle, and the batch can close them (closeOptions only counts them for discard).
  const merge = closeOptions(w, base, 0).merge;
  return merge.allowed ? { group: "ready" } : { group: "busy", reason: merge.reason };
}

export type StepState = "pending" | "running" | "merged" | "removed" | "conflict" | "error";
export type Step = { path: string; name: string; state: StepState; detail?: string };

type Call = <T>(method: string, params: Record<string, unknown>) => Promise<T>;

export type BulkDeps = {
  call: Call;
  /** git.* `repo` param of the main checkout (where merges land). */
  repo: string;
  /** Closes these panes (and their agents); resolves once their processes are gone. */
  closePanes: (ids: string[]) => Promise<void>;
  /** The worktree's review comments go with it. */
  dropComments: (path: string) => Promise<void>;
  onStep: (steps: Step[]) => void;
};

export type BulkItem = { worktree: WorktreeInfo; name: string; paneIds: string[] };

function errorText(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/^git\.\w+: /, "");
}

async function removeOne(deps: BulkDeps, item: BulkItem, closePanes: boolean): Promise<void> {
  if (closePanes && item.paneIds.length > 0) await deps.closePanes(item.paneIds);
  // No force: git refuses to delete a branch that isn't merged, and the gateway refuses a worktree with changes.
  await deps.call("git.worktreeRemove", { repo: deps.repo, path: item.worktree.path, deleteBranch: true });
  await deps.dropComments(item.worktree.path);
}

/**
 * Merges each worktree's branch into the base, one at a time. A conflict is
 * aborted on the spot and the batch goes on: that worktree stays as it was.
 * With `removeAfter`, a merged worktree is removed with its branch (and its
 * panes closed, with `closePanes`). Refuses to start while the base checkout
 * has uncommitted changes. Resolves with the final steps.
 */
export async function runBulkMerge(
  deps: BulkDeps,
  items: BulkItem[],
  opts: { removeAfter: boolean; closePanes: boolean },
): Promise<Step[]> {
  const steps: Step[] = items.map((i) => ({ path: i.worktree.path, name: i.name, state: "pending" }));
  const set = (i: number, patch: Partial<Step>) => {
    steps[i] = { ...steps[i]!, ...patch };
    deps.onStep([...steps]);
  };
  deps.onStep([...steps]);
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    set(i, { state: "running" });
    try {
      const res = await deps.call<{ ok: boolean; conflicts: boolean; output?: string }>("git.merge", {
        repo: deps.repo,
        branch: item.worktree.branch,
      });
      if (res.conflicts) {
        await deps.call("git.merge", { repo: deps.repo, abort: true }).catch(() => undefined);
        set(i, { state: "conflict", detail: (res.output ?? "").trim() });
        continue;
      }
      if (!opts.removeAfter) {
        set(i, { state: "merged" });
        continue;
      }
      try {
        await removeOne(deps, item, opts.closePanes);
        set(i, { state: "removed" });
      } catch (err) {
        // Merged, but the cleanup failed: say both.
        set(i, { state: "merged", detail: errorText(err) });
      }
    } catch (err) {
      set(i, { state: "error", detail: errorText(err) });
    }
  }
  return steps;
}

/** Removes each worktree (and its branch, panes and comments). Nothing is forced. */
export async function runBulkRemove(deps: BulkDeps, items: BulkItem[], opts: { closePanes: boolean }): Promise<Step[]> {
  const steps: Step[] = items.map((i) => ({ path: i.worktree.path, name: i.name, state: "pending" }));
  deps.onStep([...steps]);
  for (let i = 0; i < items.length; i++) {
    steps[i] = { ...steps[i]!, state: "running" };
    deps.onStep([...steps]);
    try {
      await removeOne(deps, items[i]!, opts.closePanes);
      steps[i] = { ...steps[i]!, state: "removed" };
    } catch (err) {
      steps[i] = { ...steps[i]!, state: "error", detail: errorText(err) };
    }
    deps.onStep([...steps]);
  }
  return steps;
}

/**
 * How many uncommitted changes to tracked files the base checkout has: a batch
 * of merges on top of them is refused up front. Untracked files don't count
 * (git only stops if a merge would overwrite one, and then that merge fails on its own).
 */
export async function baseChanges(call: Call, repo: string): Promise<number> {
  const st = await call<{ changes: Array<{ kind: string }> }>("git.status2", { repo });
  return st.changes.filter((c) => c.kind !== "untracked").length;
}
