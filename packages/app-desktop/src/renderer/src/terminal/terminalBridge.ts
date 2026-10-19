import type { LeafPane } from "./paneTree.js";
import type { AgentTeam } from "../types.js";

/**
 * Module-level pub-sub so AgentFlowView (a MainTabs sibling with no shared
 * ancestor state) can trigger TerminalContainer's pane-tree reducer without
 * lifting that reducer up — TerminalContainer owns real effects (hydrate,
 * debounced save, prune-on-close) that shouldn't move just to expose one
 * cross-tab action.
 */
type Listener = (leaves: LeafPane[]) => void;

let listener: Listener | null = null;

export function onLoadFlow(fn: Listener): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

export function requestLoadFlow(leaves: LeafPane[]): void {
  listener?.(leaves);
}

// Same pattern, for MainTabs's "+" next to the Terminal tab — it has no
// reducer of its own, so it just pokes TerminalContainer to add a pane.
type NewTerminalListener = () => void;

let newTerminalListener: NewTerminalListener | null = null;

export function onNewTerminal(fn: NewTerminalListener): () => void {
  newTerminalListener = fn;
  return () => {
    if (newTerminalListener === fn) newTerminalListener = null;
  };
}

export function requestNewTerminal(): void {
  newTerminalListener?.();
}

// Same pattern again, for MainTabs to tell TerminalContainer the Terminal
// tab just became visible — a pane created/written to while the Chat tab
// was active still mounts (React mount is independent of the tab's
// display:none), but its container has a zero-size box, so xterm's
// ResizeObserver never fires and the pty never gets fit()/resized. Without
// this nudge, output already delivered to the pty sits unpainted until
// something re-triggers fit() — which reads to the user as "delegation
// only works if I focus the terminal."
type TerminalTabVisibleListener = () => void;

let terminalTabVisibleListener: TerminalTabVisibleListener | null = null;

export function onTerminalTabVisible(fn: TerminalTabVisibleListener): () => void {
  terminalTabVisibleListener = fn;
  return () => {
    if (terminalTabVisibleListener === fn) terminalTabVisibleListener = null;
  };
}

export function notifyTerminalTabVisible(): void {
  terminalTabVisibleListener?.();
}

// Same pattern, for MainTabs's persistent "Teams ▾" control — resolving a
// team's nodes into leaves needs `projectPath`, which TerminalContainer
// already owns, so the bridge passes the raw AgentTeam rather than
// pre-built leaves (contrast with onLoadFlow, called from AgentFlowView
// which tracks its own projectPath).
type LoadTeamListener = (team: AgentTeam) => void;

let loadTeamListener: LoadTeamListener | null = null;

export function onLoadTeam(fn: LoadTeamListener): () => void {
  loadTeamListener = fn;
  return () => {
    if (loadTeamListener === fn) loadTeamListener = null;
  };
}

export function requestLoadTeam(team: AgentTeam): void {
  loadTeamListener?.(team);
}
