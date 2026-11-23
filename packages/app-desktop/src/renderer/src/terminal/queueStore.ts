import { useSyncExternalStore } from "react";
import type { PaneQueueView } from "../types.js";

// Message queues of this window's panes (main/paneQueueHost.ts), pushed on
// every change. Module-level like attentionStore.ts: the pane headers, the
// dock and the "closed with messages queued" notice all read it.
// See notes/features/pane-message-queue.md.

type Snapshot = Record<string, PaneQueueView>;
export type DroppedQueue = { paneId: string; title: string; count: number; at: number };

const EMPTY: Snapshot = {};
let snapshot: Snapshot = EMPTY;
let dropped: DroppedQueue | null = null;
const listeners = new Set<() => void>();
let started = false;

function emit(): void {
  listeners.forEach((fn) => fn());
}

function start(): void {
  if (started || !window.yggdrasil.projectId) return;
  started = true;
  void window.yggdrasil.queue.get().then((s) => {
    snapshot = s;
    emit();
  });
  window.yggdrasil.queue.onUpdate((s) => {
    snapshot = s;
    emit();
  });
  window.yggdrasil.queue.onDropped((info) => {
    dropped = { ...info, at: Date.now() };
    emit();
  });
}

function subscribe(fn: () => void): () => void {
  start();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useQueues(): Snapshot {
  return useSyncExternalStore(subscribe, () => snapshot);
}

export function usePaneQueue(paneId: string): PaneQueueView | undefined {
  return useSyncExternalStore(subscribe, () => snapshot[paneId]);
}

export function useDroppedQueue(): DroppedQueue | null {
  return useSyncExternalStore(subscribe, () => dropped);
}

export function dismissDroppedQueue(): void {
  dropped = null;
  emit();
}
