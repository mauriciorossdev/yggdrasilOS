import { ipcMain, type BrowserWindow } from "electron";
import {
  EMPTY_QUEUE,
  editQueued,
  enqueue,
  moveQueued,
  removeQueued,
  setPaused,
  shouldHold,
  takeNext,
  type PaneQueue,
  type QueueSource,
} from "./paneQueue.js";

/**
 * The message queues of every pane, per project window. A message for a claude
 * pane whose agent is busy waits here (terminals.ts asks through gateSubmit);
 * the attention inbox tells us when a turn ends (one message goes in), when
 * the user interrupts (the queue pauses) and when a session ends (the queue is
 * dropped). See notes/features/pane-message-queue.md.
 */

export type SubmitWhen = "auto" | "now";
export type SubmitResult = { queued: boolean; position?: number };

type Deps = {
  getWindow: (projectId: string) => BrowserWindow | undefined;
  paneTitle: (projectId: string, paneId: string) => string | undefined;
  /** The attention inbox's state of a pane (undefined: idle, or not a claude pane). */
  status: (projectId: string, paneId: string) => "working" | "waiting" | "done" | undefined;
  /** Settings → Claude Code → "Hold messages while the agent works" (and the inbox itself on). */
  enabled: () => boolean;
  /** Types the message in for real, skipping the queue. */
  deliver: (paneId: string, text: string) => Promise<void>;
};

let deps: Deps | undefined;
const queues = new Map<string, Map<string, PaneQueue>>();

function paneQueues(projectId: string): Map<string, PaneQueue> {
  let m = queues.get(projectId);
  if (!m) {
    m = new Map();
    queues.set(projectId, m);
  }
  return m;
}

function get(projectId: string, paneId: string): PaneQueue {
  return queues.get(projectId)?.get(paneId) ?? EMPTY_QUEUE;
}

function set(projectId: string, paneId: string, q: PaneQueue): void {
  const m = paneQueues(projectId);
  if (q.items.length === 0 && !q.paused) m.delete(paneId);
  else m.set(paneId, q);
  push(projectId);
}

function sourceLabel(projectId: string, source: QueueSource): string | undefined {
  if (source.kind === "orchestrator") return deps?.paneTitle(projectId, source.paneId) || source.paneId;
  if (source.kind === "workspace") return source.from;
  return undefined;
}

/** What the renderer shows: each pane's queue, with orchestrator titles resolved. */
export function queueSnapshot(projectId: string) {
  return Object.fromEntries(
    [...(queues.get(projectId) ?? new Map<string, PaneQueue>())].map(([paneId, q]) => [
      paneId,
      { paused: q.paused, items: q.items.map((m) => ({ ...m, sourceLabel: sourceLabel(projectId, m.source) })) },
    ]),
  );
}

function push(projectId: string): void {
  const win = deps?.getWindow(projectId);
  if (win && !win.isDestroyed()) win.webContents.send("queue:update", queueSnapshot(projectId));
}

function deliver(projectId: string, paneId: string, text: string): void {
  void deps?.deliver(paneId, text).catch((err) => {
    console.error("[paneQueue] delivery failed", err);
    dropPane(projectId, paneId);
  });
}

/**
 * terminals.ts's submitToTerminal asks before typing a message in. A result
 * means it was queued (and where); null means go ahead now.
 */
export function gateSubmit(
  projectId: string,
  paneId: string,
  text: string,
  meta: { source?: QueueSource; when?: SubmitWhen },
): SubmitResult | null {
  if (!deps || !text.trim()) return null;
  const q = get(projectId, paneId);
  const hold = shouldHold({
    enabled: deps.enabled(),
    when: meta.when ?? "auto",
    status: deps.status(projectId, paneId),
    queued: q.items.length,
  });
  if (!hold) return null;
  const { queue } = enqueue(q, text, meta.source ?? { kind: "app" });
  set(projectId, paneId, queue);
  return { queued: true, position: queue.items.length };
}

/**
 * A turn ended (Stop). True when a queued message goes in now, so the
 * attention inbox keeps the pane "working" instead of marking it done.
 */
export function onTurnEnd(projectId: string, paneId: string): boolean {
  const { queue, item } = takeNext(get(projectId, paneId));
  if (!item) return false;
  set(projectId, paneId, queue);
  deliver(projectId, paneId, item.text);
  return true;
}

/** Esc / Ctrl-C: the user stepped in, so nothing more goes in behind them until they resume. */
export function onInterrupt(projectId: string, paneId: string): void {
  const q = get(projectId, paneId);
  if (q.items.length > 0) set(projectId, paneId, setPaused(q, true));
}

/** The session ended or the pane closed: its queue goes, and the window says what was lost. */
export function dropPane(projectId: string, paneId: string): void {
  const q = queues.get(projectId)?.get(paneId);
  if (!q) return;
  queues.get(projectId)!.delete(paneId);
  push(projectId);
  const win = deps?.getWindow(projectId);
  if (q.items.length > 0 && win && !win.isDestroyed()) {
    win.webContents.send("queue:dropped", { paneId, title: deps?.paneTitle(projectId, paneId) || paneId, count: q.items.length });
  }
}

export function disposeQueues(projectId: string): void {
  queues.delete(projectId);
}

/** Delivers the head now if the agent is free (after resume, or a reorder while idle). */
function drainIfIdle(projectId: string, paneId: string): void {
  const status = deps?.status(projectId, paneId);
  if (status === "working" || status === "waiting") return;
  onTurnEnd(projectId, paneId);
}

/** Called once at startup by main/index.ts. */
export function installPaneQueue(d: Deps): void {
  deps = d;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  ipcMain.handle("queue:get", (_e, projectId: string) => queueSnapshot(str(projectId)));
  ipcMain.handle("queue:edit", (_e, projectId: string, paneId: string, id: string, text: string) => {
    set(str(projectId), str(paneId), editQueued(get(str(projectId), str(paneId)), str(id), str(text)));
  });
  ipcMain.handle("queue:move", (_e, projectId: string, paneId: string, id: string, delta: number) => {
    set(str(projectId), str(paneId), moveQueued(get(str(projectId), str(paneId)), str(id), delta < 0 ? -1 : 1));
  });
  ipcMain.handle("queue:remove", (_e, projectId: string, paneId: string, id: string) => {
    set(str(projectId), str(paneId), removeQueued(get(str(projectId), str(paneId)), str(id)).queue);
  });
  ipcMain.handle("queue:clear", (_e, projectId: string, paneId: string) => {
    set(str(projectId), str(paneId), EMPTY_QUEUE);
  });
  ipcMain.handle("queue:pause", (_e, projectId: string, paneId: string, paused: boolean) => {
    const p = str(projectId);
    const pane = str(paneId);
    set(p, pane, setPaused(get(p, pane), Boolean(paused)));
    if (!paused) drainIfIdle(p, pane);
  });
  ipcMain.handle("queue:sendNow", (_e, projectId: string, paneId: string, id: string) => {
    const p = str(projectId);
    const pane = str(paneId);
    const { queue, item } = removeQueued(get(p, pane), str(id));
    if (!item) return;
    set(p, pane, queue);
    deliver(p, pane, item.text);
  });
}
