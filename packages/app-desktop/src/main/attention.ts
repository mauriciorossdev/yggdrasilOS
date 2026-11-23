/**
 * Attention state of `claude` panes — which one is working, waiting for the
 * user (a permission prompt or a question) or done with its turn and not yet
 * looked at. See notes/features/attention-inbox.md.
 *
 * Signals come from Claude Code hooks the app injects into every `claude` pane
 * (claudePaneSettings.ts → attentionBridge.ts → paneControlServer.ts's
 * POST /attention), plus "input" (anything typed into the pane: the user, the
 * phone, an orchestrator's write_pane) and "seen" (the pane got focus).
 * Pure: no electron imports, so the rules are unit-testable.
 */

export type AttentionStatus = "working" | "waiting" | "done";

export type PaneAttention = {
  status: AttentionStatus;
  /** When this status started (ms epoch). */
  since: number;
  /** waiting: what the agent asks (the hook's message or the question). */
  message?: string;
};

export type AttentionEvent =
  | { kind: "prompt" }
  | { kind: "ask"; message?: string }
  | { kind: "notification"; notificationType?: string; message?: string }
  | { kind: "stop" }
  | { kind: "end" }
  | { kind: "input" }
  /** A lone Esc or Ctrl-C: Claude Code stops the turn, and no Stop hook fires for that. */
  | { kind: "interrupt" }
  | { kind: "seen" };

/** Notification types that mean "nothing to answer" — idle_prompt fires a minute after a finished turn. */
const QUIET_NOTIFICATIONS = new Set(["idle_prompt", "auth_success"]);

/**
 * The pane's next state (undefined = idle, nothing pending). `viewing` = the
 * user is looking at this pane right now (window focused, Terminal tab, pane
 * active and not minimized): a finished turn they watched is not "done".
 */
export function reduceAttention(
  prev: PaneAttention | undefined,
  event: AttentionEvent,
  now: number,
  viewing: boolean,
): PaneAttention | undefined {
  switch (event.kind) {
    case "prompt":
      return prev?.status === "working" ? prev : { status: "working", since: now };
    case "ask":
      return { status: "waiting", since: now, message: event.message };
    case "notification":
      if (event.notificationType && QUIET_NOTIFICATIONS.has(event.notificationType)) return prev;
      // AskUserQuestion fires "ask" (with the question) and then a generic
      // "Claude needs your permission" notification: keep the question.
      if (prev?.status === "waiting" && prev.message) return prev;
      return { status: "waiting", since: now, message: event.message };
    case "stop":
      return viewing ? undefined : { status: "done", since: now };
    case "end":
      return undefined;
    case "input":
      if (prev?.status === "waiting") return { status: "working", since: now };
      if (prev?.status === "done") return undefined;
      return prev;
    case "interrupt":
      return undefined;
    case "seen":
      return prev?.status === "done" ? undefined : prev;
  }
}

/** Parses POST /attention's body; undefined when it isn't a known hook event. */
export function parseAttentionEvent(body: Record<string, unknown>): AttentionEvent | undefined {
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 500) : undefined);
  switch (body.event) {
    case "prompt":
      return { kind: "prompt" };
    case "ask":
      return { kind: "ask", message: text(body.message) };
    case "notification":
      return { kind: "notification", notificationType: text(body.notificationType), message: text(body.message) };
    case "stop":
      return { kind: "stop" };
    case "end":
      return { kind: "end" };
    default:
      return undefined;
  }
}

export type AttentionChange = { paneId: string; prev: PaneAttention | undefined; next: PaneAttention | undefined };

/** One project window's pane states. `onChange` fires only when a pane's status actually changed. */
export class AttentionTracker {
  private readonly panes = new Map<string, PaneAttention>();
  private viewingPaneId: string | null = null;

  constructor(
    private readonly isWindowFocused: () => boolean,
    private readonly onChange: (change: AttentionChange) => void,
    private readonly now: () => number = Date.now,
  ) {}

  /** The pane the renderer shows as active on the Terminal tab (null: another tab, or it is minimized). */
  setViewing(paneId: string | null): void {
    this.viewingPaneId = paneId;
    if (paneId && this.isWindowFocused()) this.apply(paneId, { kind: "seen" });
  }

  /** The window regained focus: the pane on screen counts as seen. */
  windowFocused(): void {
    if (this.viewingPaneId) this.apply(this.viewingPaneId, { kind: "seen" });
  }

  isViewing(paneId: string): boolean {
    return this.viewingPaneId === paneId && this.isWindowFocused();
  }

  apply(paneId: string, event: AttentionEvent): void {
    const prev = this.panes.get(paneId);
    const next = reduceAttention(prev, event, this.now(), this.isViewing(paneId));
    if (next === prev) return;
    if (next) this.panes.set(paneId, next);
    else this.panes.delete(paneId);
    if (prev?.status === next?.status && prev?.message === next?.message) return;
    this.onChange({ paneId, prev, next });
  }

  snapshot(): Record<string, PaneAttention> {
    return Object.fromEntries(this.panes);
  }
}

/**
 * Batches "done" notifications: a team finishing together gets one
 * notification, not six. `flush` receives every pane id that finished within
 * `windowMs` of the first one.
 */
export class DoneBatcher {
  private pending: string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly flush: (paneIds: string[]) => void,
    private readonly windowMs = 3000,
  ) {}

  add(paneId: string): void {
    if (!this.pending.includes(paneId)) this.pending.push(paneId);
    if (this.timer) return;
    this.timer = setTimeout(() => {
      const ids = this.pending;
      this.pending = [];
      this.timer = null;
      if (ids.length > 0) this.flush(ids);
    }, this.windowMs);
  }

  /** A pane that left "done" before the batch went out is dropped from it. */
  drop(paneId: string): void {
    this.pending = this.pending.filter((id) => id !== paneId);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = [];
  }
}

/**
 * Whether bytes written to a pane are something a person (or agent) typed,
 * as opposed to replies xterm.js sends on its own: focus in/out reports,
 * cursor-position and device-attribute replies, OSC replies, mouse reports.
 * Only real input should clear "waiting" — focusing the pane is not an answer.
 */
/** What bytes written to a pane mean for its attention state, if anything. */
export function inputEvent(data: string): AttentionEvent | undefined {
  if (data === "\x1b" || data === "\x03") return { kind: "interrupt" };
  return isUserInput(data) ? { kind: "input" } : undefined;
}

export function isUserInput(data: string): boolean {
  const automatic =
    /\x1b\[[IO]|\x1b\[\d+;\d+R|\x1b\[[?>][\d;]*c|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[<[\d;]+[Mm]|\x1b\[M[\s\S]{3}/g;
  return data.replace(automatic, "").length > 0;
}
