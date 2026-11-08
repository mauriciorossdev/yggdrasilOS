import type { MainTab } from "../ui/mainTabsStore.js";
import type { TerminalPaneSummary } from "../terminal/terminalPanesStore.js";

/** Where a file can be sent from the tree's context menu. */
export type SendTarget =
  | { kind: "chat"; label: string; focused: boolean }
  | { kind: "terminal"; id: string; label: string; focused: boolean };

/**
 * The chat plus every open terminal, with the one the user is working in marked:
 * the focused pane while the Terminal tab is showing, the chat while the Chat tab is.
 * Minimized panes stay in the list (they can still be written to), tagged so it is clear.
 */
export function buildSendTargets(panes: TerminalPaneSummary[], activePaneId: string | null, activeTab: MainTab): SendTarget[] {
  const targets: SendTarget[] = [{ kind: "chat", label: "Chat", focused: activeTab === "chat" }];
  for (const pane of panes) {
    targets.push({
      kind: "terminal",
      id: pane.id,
      label: pane.minimized ? `${pane.title} (minimizada)` : pane.title,
      focused: activeTab === "terminal" && pane.id === activePaneId,
    });
  }
  return targets;
}

/**
 * A path as a shell would take it: left alone when it is plain, quoted otherwise.
 * POSIX shells get single quotes (nothing inside is special, a literal ' is closed,
 * escaped and reopened); Windows shells get double quotes.
 */
export function quotePathForShell(path: string, windows: boolean): string {
  if (windows) return /[\s&()^%!;,'"`]/.test(path) ? `"${path.replace(/"/g, '\\"')}"` : path;
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(path) ? path : `'${path.replace(/'/g, `'\\''`)}'`;
}
