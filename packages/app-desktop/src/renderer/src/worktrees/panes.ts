import type { TerminalPaneSummary } from "../terminal/terminalPanesStore.js";
import { isInside, pathKey } from "./paths.js";

/**
 * Panes that belong to a worktree: those whose folder is inside it. Each pane
 * goes to the deepest worktree that contains it, so a pane in
 * `<repo>/.yggdrasil/worktrees/a` is not also counted for the main checkout.
 * Uses the folder the pane was opened in (a `cd` afterwards isn't seen yet).
 */
export function panesByWorktree(panes: TerminalPaneSummary[], worktreePaths: string[]): Map<string, TerminalPaneSummary[]> {
  const result = new Map<string, TerminalPaneSummary[]>(worktreePaths.map((p) => [p, []]));
  const sorted = [...worktreePaths].sort((a, b) => pathKey(b).length - pathKey(a).length);
  for (const pane of panes) {
    if (!pane.cwd) continue;
    const owner = sorted.find((w) => isInside(w, pane.cwd!));
    if (owner) result.get(owner)!.push(pane);
  }
  return result;
}

/**
 * Adds, to each worktree, the pane running the Claude session that locked it
 * (resolved by pid in the main process), unless the folder rule already found it.
 * A pane that opened in the project root and then ran `claude --worktree` is
 * only linkable this way.
 */
export function addPidPanes(
  byCwd: Map<string, TerminalPaneSummary[]>,
  pidPane: Record<string, string>,
  panes: TerminalPaneSummary[],
): Map<string, TerminalPaneSummary[]> {
  const result = new Map(byCwd);
  for (const [path, paneId] of Object.entries(pidPane)) {
    const pane = panes.find((p) => p.id === paneId);
    const current = result.get(path) ?? [];
    if (pane && !current.some((p) => p.id === pane.id)) result.set(path, [...current, pane]);
  }
  return result;
}
