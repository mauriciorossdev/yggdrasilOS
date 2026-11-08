import { describe, expect, it } from "vitest";
import { callSignature, computeMetrics, extractToolCalls, longestRepeat } from "./metrics.js";
import type { RecordedEvent, TurnOutcome } from "./types.js";

const ev = (event: string, payload: Record<string, unknown>, t = 0): RecordedEvent => ({ t, event, payload });
const tool = (toolName: string, status: string, args: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  ev("tool.execute", { toolName, status, args, ...extra });
const turn = (over: Partial<TurnOutcome> = {}): TurnOutcome => ({ prompt: "p", reply: "r", durationMs: 1000, cancelled: null, ...over });

describe("extractToolCalls", () => {
  it("counts only settled calls", () => {
    const calls = extractToolCalls([tool("a", "running"), tool("a", "ok", {}, { result: "x" }), ev("chat.delta", {})]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ name: "a", ok: true, result: "x" });
  });
});

describe("callSignature / longestRepeat", () => {
  it("ignores argument order", () => {
    expect(callSignature({ name: "t", args: { a: 1, b: 2 } })).toBe(callSignature({ name: "t", args: { b: 2, a: 1 } }));
  });
  it("finds the longest back-to-back run", () => {
    const c = (n: string, a = {}) => ({ name: n, args: a });
    expect(longestRepeat([c("a"), c("a"), c("b"), c("a"), c("a"), c("a")])).toBe(3);
    expect(longestRepeat([])).toBe(0);
  });
});

describe("computeMetrics", () => {
  it("summarises calls, errors, repeats and recoveries", () => {
    const events = [
      tool("run", "error", { cmd: "x" }, { error: "boom" }),
      tool("read", "ok", { path: "a" }),
      tool("read", "ok", { path: "a" }),
      ev("chat.delta", { text: "hi" }),
      ev("provider.retry", { attempt: 1, reason: "HTTP 500" }),
      ev("provider.retry", { attempt: 2, reason: "HTTP 500" }),
      ev("loop.guard", { kind: "empty-retry" }),
      ev("loop.guard", { kind: "empty-retry" }),
      ev("loop.guard", { kind: "action-nudge" }),
    ];
    const m = computeMetrics(events, [turn({ usage: { inputTokens: 10, outputTokens: 5 } }), turn({ cancelled: "timeout" })], [
      { t: 0, toolName: "run", args: {}, approved: false, reason: "no" },
      { t: 0, toolName: "run", args: {}, approved: true, reason: "ok" },
    ]);
    expect(m).toMatchObject({
      toolCalls: 3,
      toolErrors: 1,
      repeatedCalls: 1,
      longestRepeat: 2,
      recoveries: 1,
      approvalsAsked: 2,
      approvalsDenied: 1,
      turns: 2,
      cancelledTurns: 1,
      inputTokens: 10,
      outputTokens: 5,
      deltas: 1,
    });
    expect(m.byTool).toEqual({ run: 1, read: 2 });
    expect(m.providerRetries).toBe(2);
    expect(m.guards).toEqual({ "empty-retry": 2, "action-nudge": 1 });
    expect(m.durationMs).toBe(2000);
  });
});
