import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AttentionTracker,
  DoneBatcher,
  inputEvent,
  isUserInput,
  parseAttentionEvent,
  reduceAttention,
  type AttentionChange,
  type PaneAttention,
} from "./attention.js";
import { attentionBody } from "./attentionBridge.js";

const working: PaneAttention = { status: "working", since: 1 };
const waiting: PaneAttention = { status: "waiting", since: 1, message: "Allow Bash?" };
const done: PaneAttention = { status: "done", since: 1 };

describe("reduceAttention", () => {
  it("a prompt starts working, keeping the start time if already working", () => {
    expect(reduceAttention(undefined, { kind: "prompt" }, 5, false)).toEqual({ status: "working", since: 5 });
    expect(reduceAttention(working, { kind: "prompt" }, 5, false)).toBe(working);
    expect(reduceAttention(done, { kind: "prompt" }, 5, false)).toEqual({ status: "working", since: 5 });
  });

  it("a permission notification or a question means waiting, even while viewing", () => {
    expect(reduceAttention(working, { kind: "notification", notificationType: "permission_prompt", message: "Allow?" }, 5, false)).toEqual({
      status: "waiting",
      since: 5,
      message: "Allow?",
    });
    expect(reduceAttention(working, { kind: "ask", message: "Which branch?" }, 5, true)).toEqual({
      status: "waiting",
      since: 5,
      message: "Which branch?",
    });
  });

  it("the generic notification after a question keeps the question", () => {
    const asked = reduceAttention(working, { kind: "ask", message: "Which color?" }, 5, false);
    expect(reduceAttention(asked, { kind: "notification", message: "Claude needs your permission" }, 6, false)).toBe(asked);
  });

  it("idle_prompt is not a question: nothing changes", () => {
    expect(reduceAttention(done, { kind: "notification", notificationType: "idle_prompt" }, 5, false)).toBe(done);
    expect(reduceAttention(undefined, { kind: "notification", notificationType: "idle_prompt" }, 5, false)).toBeUndefined();
  });

  it("stop is done unless the user is looking at the pane", () => {
    expect(reduceAttention(working, { kind: "stop" }, 5, false)).toEqual({ status: "done", since: 5 });
    expect(reduceAttention(working, { kind: "stop" }, 5, true)).toBeUndefined();
  });

  it("input answers a waiting pane and clears a done one", () => {
    expect(reduceAttention(waiting, { kind: "input" }, 5, false)).toEqual({ status: "working", since: 5 });
    expect(reduceAttention(done, { kind: "input" }, 5, false)).toBeUndefined();
    expect(reduceAttention(working, { kind: "input" }, 5, false)).toBe(working);
  });

  it("an interrupt (Esc / Ctrl-C) ends the turn: no Stop hook comes for it", () => {
    expect(reduceAttention(working, { kind: "interrupt" }, 5, false)).toBeUndefined();
    expect(reduceAttention(waiting, { kind: "interrupt" }, 5, false)).toBeUndefined();
  });

  it("seen clears only done; end clears everything", () => {
    expect(reduceAttention(done, { kind: "seen" }, 5, true)).toBeUndefined();
    expect(reduceAttention(waiting, { kind: "seen" }, 5, true)).toBe(waiting);
    expect(reduceAttention(waiting, { kind: "end" }, 5, false)).toBeUndefined();
  });
});

describe("parseAttentionEvent", () => {
  it("maps the bridge's body and trims messages", () => {
    expect(parseAttentionEvent({ event: "notification", notificationType: "permission_prompt", message: "  Allow?  " })).toEqual({
      kind: "notification",
      notificationType: "permission_prompt",
      message: "Allow?",
    });
    expect(parseAttentionEvent({ event: "stop" })).toEqual({ kind: "stop" });
    expect(parseAttentionEvent({ event: "input" })).toBeUndefined();
    expect(parseAttentionEvent({})).toBeUndefined();
  });
});

describe("AttentionTracker", () => {
  const setup = (focused = false) => {
    const changes: AttentionChange[] = [];
    let isFocused = focused;
    let now = 100;
    const tracker = new AttentionTracker(
      () => isFocused,
      (c) => changes.push(c),
      () => now,
    );
    return { tracker, changes, focus: (v: boolean) => (isFocused = v), tick: (t: number) => (now = t) };
  };

  it("reports status changes only", () => {
    const { tracker, changes } = setup();
    tracker.apply("p1", { kind: "prompt" });
    tracker.apply("p1", { kind: "prompt" });
    tracker.apply("p1", { kind: "stop" });
    expect(changes.map((c) => c.next?.status)).toEqual(["working", "done"]);
    expect(tracker.snapshot()).toEqual({ p1: { status: "done", since: 100 } });
  });

  it("a turn that ends on the pane being viewed in a focused window is not done", () => {
    const { tracker } = setup(true);
    tracker.setViewing("p1");
    tracker.apply("p1", { kind: "prompt" });
    tracker.apply("p1", { kind: "stop" });
    expect(tracker.snapshot()).toEqual({});
  });

  it("viewing alone doesn't count when the window isn't focused; focusing it does", () => {
    const { tracker, focus } = setup(false);
    tracker.setViewing("p1");
    tracker.apply("p1", { kind: "stop" });
    expect(tracker.snapshot().p1?.status).toBe("done");
    focus(true);
    tracker.windowFocused();
    expect(tracker.snapshot()).toEqual({});
  });

  it("switching to a done pane marks it seen", () => {
    const { tracker } = setup(true);
    tracker.apply("p2", { kind: "stop" });
    expect(tracker.snapshot().p2?.status).toBe("done");
    tracker.setViewing("p2");
    expect(tracker.snapshot()).toEqual({});
  });
});

describe("DoneBatcher", () => {
  afterEach(() => vi.useRealTimers());

  it("sends panes finishing within the window together, minus ones dropped", () => {
    vi.useFakeTimers();
    const flushed: string[][] = [];
    const batcher = new DoneBatcher((ids) => flushed.push(ids), 3000);
    batcher.add("a");
    vi.advanceTimersByTime(1000);
    batcher.add("b");
    batcher.add("c");
    batcher.drop("c");
    vi.advanceTimersByTime(2000);
    expect(flushed).toEqual([["a", "b"]]);
    batcher.add("d");
    vi.advanceTimersByTime(3000);
    expect(flushed).toEqual([["a", "b"], ["d"]]);
  });
});

describe("inputEvent", () => {
  it("a lone Esc or Ctrl-C is an interrupt; arrows and keys are input; xterm replies are nothing", () => {
    expect(inputEvent("\x1b")).toEqual({ kind: "interrupt" });
    expect(inputEvent("\x03")).toEqual({ kind: "interrupt" });
    expect(inputEvent("\x1b[A")).toEqual({ kind: "input" });
    expect(inputEvent("y")).toEqual({ kind: "input" });
    expect(inputEvent("\x1b[I")).toBeUndefined();
  });
});

describe("isUserInput", () => {
  it("ignores replies xterm.js sends by itself", () => {
    expect(isUserInput("\x1b[I")).toBe(false);
    expect(isUserInput("\x1b[O")).toBe(false);
    expect(isUserInput("\x1b[12;40R")).toBe(false);
    expect(isUserInput("\x1b[?1;2c")).toBe(false);
    expect(isUserInput("\x1b]11;rgb:1a1a/1919/1818\x07")).toBe(false);
    expect(isUserInput("\x1b[<0;10;5M\x1b[<0;10;5m")).toBe(false);
  });

  it("counts keys, including arrows and Enter", () => {
    expect(isUserInput("1")).toBe(true);
    expect(isUserInput("\r")).toBe(true);
    expect(isUserInput("\x1b[A")).toBe(true);
    expect(isUserInput("\x1b[Ihello")).toBe(true);
  });
});

describe("attentionBody", () => {
  it("carries the notification text and type, or the question asked", () => {
    expect(attentionBody("notification", "p1", { message: "Allow?", notification_type: "permission_prompt" })).toEqual({
      event: "notification",
      paneId: "p1",
      message: "Allow?",
      notificationType: "permission_prompt",
    });
    expect(attentionBody("ask", "p1", { tool_input: { questions: [{ question: "Which branch?" }] } })).toEqual({
      event: "ask",
      paneId: "p1",
      message: "Which branch?",
    });
    expect(attentionBody("stop", "p1", { message: "ignored" })).toEqual({ event: "stop", paneId: "p1" });
  });
});
