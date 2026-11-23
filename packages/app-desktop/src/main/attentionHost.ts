import { BrowserWindow, ipcMain, Notification } from "electron";
import { AttentionTracker, DoneBatcher, type AttentionChange, type AttentionEvent } from "./attention.js";
import { currentAttentionSettings } from "./claudePaneSettings.js";
import { mt } from "./i18n.js";
import { terminalExists } from "./terminals.js";

/**
 * One AttentionTracker per project window, plus what it does with changes:
 * pushes "attention:update" to the window and shows a system notification
 * when the window isn't focused. See notes/features/attention-inbox.md.
 */

type Deps = {
  getWindow: (projectId: string) => BrowserWindow | undefined;
  /** The title the renderer's Terminal tab shows for a pane, if it reported one. */
  paneTitle: (projectId: string, paneId: string) => string | undefined;
};

type Entry = { tracker: AttentionTracker; batcher: DoneBatcher; focusHooked: BrowserWindow | null };

const entries = new Map<string, Entry>();
const liveNotifications = new Set<Notification>();
let deps: Deps | undefined;

function titleOf(projectId: string, paneId: string): string {
  return deps?.paneTitle(projectId, paneId) || paneId;
}

function push(projectId: string): void {
  const win = deps?.getWindow(projectId);
  const entry = entries.get(projectId);
  if (!win || win.isDestroyed() || !entry) return;
  win.webContents.send("attention:update", liveSnapshot(entry));
}

/** The tracker's states minus panes that are gone (closed or killed without a SessionEnd). */
function liveSnapshot(entry: Entry) {
  return Object.fromEntries(Object.entries(entry.tracker.snapshot()).filter(([id]) => terminalExists(id)));
}

function notify(projectId: string, title: string, body: string, paneId: string): void {
  if (!Notification.isSupported()) return;
  const win = deps?.getWindow(projectId);
  if (!win || win.isDestroyed() || win.isFocused()) return;
  const n = new Notification({ title, body, silent: false });
  // Held until clicked or closed: a notification only referenced locally can be
  // garbage-collected, and on macOS its click handler then never fires.
  liveNotifications.add(n);
  n.on("close", () => liveNotifications.delete(n));
  n.on("click", () => {
    liveNotifications.delete(n);
    if (win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.webContents.send("attention:reveal", paneId);
  });
  n.show();
}

function onChange(projectId: string, change: AttentionChange): void {
  const entry = entries.get(projectId);
  if (!entry) return;
  push(projectId);
  const settings = currentAttentionSettings();
  if (change.next?.status !== "done") entry.batcher.drop(change.paneId);
  if (change.next?.status === "waiting" && change.prev?.status !== "waiting" && settings.notifyWaiting) {
    notify(
      projectId,
      mt("attention.waitingTitle", { pane: titleOf(projectId, change.paneId) }),
      change.next.message ?? mt("attention.waitingBody"),
      change.paneId,
    );
  }
  if (change.next?.status === "done" && settings.notifyDone) entry.batcher.add(change.paneId);
}

function flushDone(projectId: string, paneIds: string[]): void {
  const entry = entries.get(projectId);
  // Only those still "done": one looked at meanwhile needs no notification.
  const still = paneIds.filter((id) => entry?.tracker.snapshot()[id]?.status === "done");
  if (still.length === 0) return;
  if (still.length === 1) {
    notify(projectId, mt("attention.doneTitle", { pane: titleOf(projectId, still[0]!) }), mt("attention.doneBody"), still[0]!);
  } else {
    notify(
      projectId,
      mt("attention.manyDoneTitle", { count: still.length }),
      still.map((id) => titleOf(projectId, id)).join(", "),
      still[0]!,
    );
  }
}

function entryFor(projectId: string): Entry {
  let entry = entries.get(projectId);
  if (!entry) {
    const tracker = new AttentionTracker(
      () => {
        const win = deps?.getWindow(projectId);
        return Boolean(win && !win.isDestroyed() && win.isFocused());
      },
      (change) => onChange(projectId, change),
    );
    entry = { tracker, batcher: new DoneBatcher((ids) => flushDone(projectId, ids)), focusHooked: null };
    entries.set(projectId, entry);
  }
  // The window exists only after paneControlServer (which reports events) has started.
  const win = deps?.getWindow(projectId);
  if (win && !win.isDestroyed() && entry.focusHooked !== win) {
    const tracker = entry.tracker;
    win.on("focus", () => tracker.windowFocused());
    entry.focusHooked = win;
  }
  return entry;
}

/** The message queue (paneQueueHost.ts) hears about turn ends, interruptions and ended sessions. */
type QueueHooks = {
  /** True when a queued message goes in now: the pane keeps working instead of turning "done". */
  onTurnEnd: (projectId: string, paneId: string) => boolean;
  onInterrupt: (projectId: string, paneId: string) => void;
  onEnd: (projectId: string, paneId: string) => void;
};
let queueHooks: QueueHooks | undefined;

export function setQueueHooks(hooks: QueueHooks): void {
  queueHooks = hooks;
}

/** A pane's current state, for the message queue's "is the agent busy?". */
export function paneAttentionStatus(projectId: string, paneId: string): "working" | "waiting" | "done" | undefined {
  return entries.get(projectId)?.tracker.snapshot()[paneId]?.status;
}

/** A hook event from a pane of this project (paneControlServer.ts's POST /attention). */
export function reportAttention(projectId: string, paneId: string, event: AttentionEvent): void {
  // A turn that ends with messages queued hands the next one over: no "done", no notification.
  if (event.kind === "stop" && queueHooks?.onTurnEnd(projectId, paneId)) return;
  entryFor(projectId).tracker.apply(paneId, event);
  if (event.kind === "end") queueHooks?.onEnd(projectId, paneId);
}

/** Real input reached a pane (terminals.ts): answers a "waiting", clears a "done"; Esc/Ctrl-C ends the turn. */
export function reportPaneInput(projectId: string, paneId: string, event: AttentionEvent): void {
  entries.get(projectId)?.tracker.apply(paneId, event);
  if (event.kind === "interrupt") queueHooks?.onInterrupt(projectId, paneId);
}

export function disposeAttention(projectId: string): void {
  entries.get(projectId)?.batcher.dispose();
  entries.delete(projectId);
}

/** Called once at startup by main/index.ts. */
export function installAttention(d: Deps): void {
  deps = d;
  ipcMain.handle("attention:get", (_event, projectId: string) => liveSnapshot(entryFor(projectId)));
  ipcMain.handle("attention:viewing", (_event, projectId: string, paneId: string | null) => {
    entryFor(projectId).tracker.setViewing(typeof paneId === "string" ? paneId : null);
  });
  ipcMain.handle("attention:seen", (_event, projectId: string, paneId: string) => {
    if (typeof paneId === "string") entryFor(projectId).tracker.apply(paneId, { kind: "seen" });
  });
  ipcMain.handle("attention:clearDone", (_event, projectId: string) => {
    const entry = entryFor(projectId);
    for (const [id, state] of Object.entries(entry.tracker.snapshot())) {
      if (state.status === "done") entry.tracker.apply(id, { kind: "seen" });
    }
  });
}
