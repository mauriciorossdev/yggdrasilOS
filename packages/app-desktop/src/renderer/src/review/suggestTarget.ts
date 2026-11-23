import type { CodeCommentTargets, PaneAttention } from "../types.js";

type Pane = CodeCommentTargets["panes"][number];

const WORKTREE_DIRS = ["/.yggdrasil/worktrees/", "/.claude/worktrees/"];

/** `p` is `root` or inside it, but not inside one of its linked worktrees (those are other checkouts). */
function worksIn(root: string, cwd: string): boolean {
  if (cwd === root) return true;
  if (!cwd.startsWith(`${root}/`)) return false;
  const rest = cwd.slice(root.length);
  return !WORKTREE_DIRS.some((d) => rest.startsWith(d));
}

const RANK: Record<string, number> = { done: 0, none: 1, waiting: 2, working: 3 };

/**
 * The pane most likely to have done the work under review: its cwd is the repo
 * or worktree root (or a folder in it). Among several, a claude pane first,
 * then the one that most recently finished a turn (attention "done"), then idle
 * ones, then busy ones. Undefined when no pane works there.
 */
export function suggestPane(root: string, panes: readonly Pane[], attention: Record<string, PaneAttention>): Pane | undefined {
  const here = panes.filter((p) => p.cwd && worksIn(root, p.cwd.replace(/\/+$/, "")));
  const score = (p: Pane) => {
    const a = attention[p.id];
    return [p.command === "claude" ? 0 : 1, RANK[a?.status ?? "none"] ?? 1, -(a?.since ?? 0)];
  };
  return [...here].sort((x, y) => {
    const a = score(x);
    const b = score(y);
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
    return 0;
  })[0];
}
