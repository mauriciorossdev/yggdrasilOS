import { describe, expect, it } from "vitest";
import { initialState, tuiReducer } from "./store.js";

const retry = { type: "PROVIDER_RETRY" as const, payload: { sessionKey: "s", attempt: 2, delayMs: 4000, reason: "HTTP 500" } };

describe("provider retry notice", () => {
  it("is set by a retry and cleared once anything arrives or the turn ends", () => {
    const waiting = tuiReducer({ ...initialState(), isTurnActive: true }, retry);
    expect(waiting.retryNotice).toEqual({ attempt: 2, delayMs: 4000, reason: "HTTP 500" });

    expect(tuiReducer(waiting, { type: "CHAT_DELTA", payload: { sessionKey: "s", text: "x", partial: true } }).retryNotice).toBeNull();
    expect(tuiReducer(waiting, { type: "TOOL_EXECUTE", payload: { sessionKey: "s", toolName: "t", status: "ok" } }).retryNotice).toBeNull();
    expect(tuiReducer(waiting, { type: "TURN_END", payload: { sessionKey: "s", harnessId: "h", classification: "ok", durationMs: 1 } }).retryNotice).toBeNull();
    expect(tuiReducer(waiting, { type: "CHAT_FINAL", payload: { sessionKey: "s", text: "done", harnessId: "h" } }).retryNotice).toBeNull();
  });
});
