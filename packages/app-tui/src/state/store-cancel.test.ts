import { describe, expect, it } from "vitest";
import { initialState, tuiReducer, type TuiState } from "./store.js";

const running = (): TuiState => ({ ...initialState(), isTurnActive: true, isStreaming: true, streamingText: "par" });

describe("cancel and resync reducer cases", () => {
  it("marks a running turn as cancelling", () => {
    expect(tuiReducer(running(), { type: "CANCEL_REQUESTED" }).isCancelling).toBe(true);
  });
  it("ignores a cancel when nothing is running", () => {
    expect(tuiReducer(initialState(), { type: "CANCEL_REQUESTED" }).isCancelling).toBe(false);
  });
  it("clears cancelling and any open approval when the turn ends", () => {
    const state = {
      ...running(),
      isCancelling: true,
      pendingApproval: { requestId: "r", toolName: "t", args: {} },
    };
    const next = tuiReducer(state, {
      type: "TURN_END",
      payload: { sessionKey: "s", harnessId: "h", classification: "cancelled", durationMs: 5 },
    });
    expect(next).toMatchObject({ isTurnActive: false, isCancelling: false, pendingApproval: null });
  });
  it("settles a cancel that found nothing to cancel", () => {
    expect(tuiReducer({ ...running(), isCancelling: true }, { type: "CANCEL_SETTLED" }).isCancelling).toBe(false);
  });
  it("replaces the transcript on resync and appends the notice", () => {
    const state = { ...running(), messages: [{ id: "old", role: "user" as const, text: "stale", timestamp: 1 }] };
    const next = tuiReducer(state, {
      type: "RESYNC_SESSION",
      messages: [{ id: "new", role: "assistant", text: "fresh", timestamp: 2 }],
      notice: "back",
    });
    expect(next.messages.map((m) => m.text)).toEqual(["fresh", "back"]);
    expect(next).toMatchObject({ isStreaming: false, isTurnActive: false, streamingText: "" });
  });
});
