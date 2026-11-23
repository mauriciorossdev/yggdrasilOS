import { useSyncExternalStore } from "react";
import type { PaneAttention } from "../types.js";
import { requestFocusPane } from "./terminalPanesStore.js";

// Attention states of this window's claude panes (waiting / done / working),
// kept by main/attentionHost.ts and pushed on every change. Module-level, like
// terminalPanesStore.ts: the title bar, the pane headers and the dock all read
// it without a shared React ancestor. See notes/features/attention-inbox.md.

type Snapshot = Record<string, PaneAttention>;

const EMPTY: Snapshot = {};
let snapshot: Snapshot = EMPTY;
const listeners = new Set<() => void>();
let started = false;

function set(next: Snapshot): void {
  snapshot = next;
  listeners.forEach((fn) => fn());
}

function start(): void {
  if (started || !window.yggdrasil.projectId) return;
  started = true;
  void window.yggdrasil.attention.get().then(set);
  window.yggdrasil.attention.onUpdate(set);
  // A click on a system notification brings the pane to front.
  window.yggdrasil.attention.onReveal((paneId) => requestFocusPane(paneId));
}

function subscribe(fn: () => void): () => void {
  start();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useAttention(): Snapshot {
  return useSyncExternalStore(subscribe, () => snapshot);
}

export function usePaneAttention(paneId: string): PaneAttention | undefined {
  return useSyncExternalStore(subscribe, () => snapshot[paneId]);
}

/** Minutes/hours since `since`, for "Done · 2 min ago". */
export function agoParts(since: number, now: number): { key: "attn.ago.now" | "attn.ago.min" | "attn.ago.hour"; n: number } {
  const minutes = Math.floor((now - since) / 60_000);
  if (minutes < 1) return { key: "attn.ago.now", n: 0 };
  if (minutes < 60) return { key: "attn.ago.min", n: minutes };
  return { key: "attn.ago.hour", n: Math.floor(minutes / 60) };
}

export type AttentionItem = { id: string; state: PaneAttention };

/** Waiting first (oldest first: it has waited longest), then done (newest first). Working/idle panes aren't listed. */
export function pendingItems(states: Snapshot, livePaneIds: Set<string>): { waiting: AttentionItem[]; done: AttentionItem[] } {
  const items = Object.entries(states)
    .filter(([id]) => livePaneIds.has(id))
    .map(([id, state]) => ({ id, state }));
  return {
    waiting: items.filter((i) => i.state.status === "waiting").sort((a, b) => a.state.since - b.state.since),
    done: items.filter((i) => i.state.status === "done").sort((a, b) => b.state.since - a.state.since),
  };
}
