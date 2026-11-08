import { useSyncExternalStore } from "react";

// What the sidebar (a MainTabs sibling with no shared ancestor state) needs to
// know about the open terminal panes, plus a way to ask TerminalContainer —
// which owns the pane tree — to bring one to front. Same module-level shape as
// terminalBridge.ts / mainTabsStore.ts.

export type TerminalPaneSummary = { id: string; title: string; command?: string; cwd?: string; minimized: boolean; docked: boolean };
export type TerminalPanesSnapshot = { panes: TerminalPaneSummary[]; activeId: string | null };

const EMPTY: TerminalPanesSnapshot = { panes: [], activeId: null };

let snapshot: TerminalPanesSnapshot = EMPTY;
const listeners = new Set<() => void>();

function sameSnapshot(a: TerminalPanesSnapshot, b: TerminalPanesSnapshot): boolean {
  return (
    a.activeId === b.activeId &&
    a.panes.length === b.panes.length &&
    a.panes.every((p, i) => {
      const q = b.panes[i]!;
      return p.id === q.id && p.title === q.title && p.command === q.command && p.cwd === q.cwd && p.minimized === q.minimized && p.docked === q.docked;
    })
  );
}

/** Called by TerminalContainer on every pane-tree change; a no-op when nothing the sidebar shows changed. */
export function publishTerminalPanes(next: TerminalPanesSnapshot): void {
  if (sameSnapshot(snapshot, next)) return;
  snapshot = next;
  listeners.forEach((fn) => fn());
}

export function useTerminalPanes(): TerminalPanesSnapshot {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => snapshot,
  );
}

type FocusListener = (id: string) => void;
let focusListener: FocusListener | null = null;

/** TerminalContainer registers how to un-minimize + focus a pane. */
export function onFocusPane(fn: FocusListener): () => void {
  focusListener = fn;
  return () => {
    if (focusListener === fn) focusListener = null;
  };
}

export function requestFocusPane(id: string): void {
  focusListener?.(id);
}
