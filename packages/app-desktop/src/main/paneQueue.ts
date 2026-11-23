import { randomUUID } from "node:crypto";

/**
 * Pure model of a pane's message queue: messages that reached a claude pane
 * while its agent was working (or waiting for an answer), held until the turn
 * ends. See notes/features/pane-message-queue.md.
 */

/** Where a queued message came from, for the list ("Teléfono", "Orquestador ‹pane›"…). */
export type QueueSource =
  | { kind: "app" }
  | { kind: "remote" }
  | { kind: "orchestrator"; paneId: string }
  | { kind: "review" }
  | { kind: "browser" }
  | { kind: "workspace"; from?: string }
  | { kind: "plugin" };

export type QueuedMessage = { id: string; text: string; source: QueueSource; createdAt: number };

export type PaneQueue = { items: QueuedMessage[]; paused: boolean };

export const EMPTY_QUEUE: PaneQueue = { items: [], paused: false };

export function enqueue(q: PaneQueue, text: string, source: QueueSource, now: number = Date.now()): { queue: PaneQueue; item: QueuedMessage } {
  const item: QueuedMessage = { id: randomUUID(), text, source, createdAt: now };
  return { item, queue: { ...q, items: [...q.items, item] } };
}

export function editQueued(q: PaneQueue, id: string, text: string): PaneQueue {
  if (!text.trim() || !q.items.some((m) => m.id === id)) return q;
  return { ...q, items: q.items.map((m) => (m.id === id ? { ...m, text } : m)) };
}

/** Moves a message one place up (-1) or down (+1); out of range does nothing. */
export function moveQueued(q: PaneQueue, id: string, delta: -1 | 1): PaneQueue {
  const i = q.items.findIndex((m) => m.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= q.items.length) return q;
  const items = [...q.items];
  [items[i], items[j]] = [items[j]!, items[i]!];
  return { ...q, items };
}

export function removeQueued(q: PaneQueue, id: string): { queue: PaneQueue; item?: QueuedMessage } {
  const item = q.items.find((m) => m.id === id);
  return item ? { item, queue: { ...q, items: q.items.filter((m) => m.id !== id) } } : { queue: q };
}

/** The message the turn that just ended hands over; nothing while paused. */
export function takeNext(q: PaneQueue): { queue: PaneQueue; item?: QueuedMessage } {
  if (q.paused || q.items.length === 0) return { queue: q };
  const [item, ...rest] = q.items;
  return { item, queue: { ...q, items: rest } };
}

export function setPaused(q: PaneQueue, paused: boolean): PaneQueue {
  return q.paused === paused ? q : { ...q, paused };
}

/**
 * Whether a message for this pane waits in the queue instead of going in now:
 * the agent is busy (working) or mid-dialog (waiting for an answer), or there
 * are messages ahead of it. "now", a non-claude pane (no state) and the
 * setting turned off always go straight in.
 */
export function shouldHold(opts: {
  enabled: boolean;
  when: "auto" | "now";
  status: "working" | "waiting" | "done" | undefined;
  queued: number;
}): boolean {
  if (!opts.enabled || opts.when === "now") return false;
  return opts.status === "working" || opts.status === "waiting" || opts.queued > 0;
}
