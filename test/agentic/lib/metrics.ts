import type { ApprovalRecord, RecordedEvent, ToolCall, TurnOutcome } from "./types.js";

export type Metrics = {
  toolCalls: number;
  toolErrors: number;
  byTool: Record<string, number>;
  /** Tool calls that repeated an identical (name + args) call. */
  repeatedCalls: number;
  /** Longest run of identical consecutive calls — a model stuck in a loop. */
  longestRepeat: number;
  /** Errors followed by a different call that succeeded: the model changed approach. */
  recoveries: number;
  approvalsAsked: number;
  approvalsDenied: number;
  turns: number;
  cancelledTurns: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  /** Times the provider waited to retry a failed request (rate limit, 5xx, dropped connection): event "provider.retry". */
  providerRetries: number;
  /** Loop guards that stepped in (event "loop.guard"), by kind: empty-retry, action-nudge, repeat-refused, limit-summary, stuck-summary. */
  guards: Record<string, number>;
  /** Streamed deltas per turn, a rough sign the model wrote prose rather than only calling tools. */
  deltas: number;
};

export function extractToolCalls(events: RecordedEvent[]): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const e of events) {
    if (e.event !== "tool.execute") continue;
    const status = e.payload.status;
    // "running" is announced before the result; only the settled one counts as a call.
    if (status !== "ok" && status !== "error") continue;
    calls.push({
      t: e.t,
      name: String(e.payload.toolName ?? "?"),
      args: (e.payload.args as Record<string, unknown>) ?? {},
      ok: status === "ok",
      result: typeof e.payload.result === "string" ? e.payload.result : undefined,
      error: typeof e.payload.error === "string" ? e.payload.error : undefined,
    });
  }
  return calls;
}

export function callSignature(call: Pick<ToolCall, "name" | "args">): string {
  const sorted = Object.keys(call.args)
    .sort()
    .map((k) => [k, call.args[k]]);
  return `${call.name}:${JSON.stringify(sorted)}`;
}

/** Longest run of back-to-back identical calls. */
export function longestRepeat(calls: Array<Pick<ToolCall, "name" | "args">>): number {
  let best = 0;
  let run = 0;
  let prev = "";
  for (const c of calls) {
    const sig = callSignature(c);
    run = sig === prev ? run + 1 : 1;
    prev = sig;
    best = Math.max(best, run);
  }
  return best;
}

export function computeMetrics(
  events: RecordedEvent[],
  turns: TurnOutcome[],
  approvals: ApprovalRecord[],
): Metrics {
  const calls = extractToolCalls(events);
  const byTool: Record<string, number> = {};
  const seen = new Set<string>();
  let repeatedCalls = 0;
  let recoveries = 0;
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i]!;
    byTool[c.name] = (byTool[c.name] ?? 0) + 1;
    const sig = callSignature(c);
    if (seen.has(sig)) repeatedCalls++;
    seen.add(sig);
    const prev = calls[i - 1];
    if (prev && !prev.ok && c.ok && callSignature(prev) !== sig) recoveries++;
  }
  return {
    toolCalls: calls.length,
    toolErrors: calls.filter((c) => !c.ok).length,
    byTool,
    repeatedCalls,
    longestRepeat: longestRepeat(calls),
    recoveries,
    approvalsAsked: approvals.length,
    approvalsDenied: approvals.filter((a) => !a.approved).length,
    turns: turns.length,
    cancelledTurns: turns.filter((t) => t.cancelled).length,
    durationMs: turns.reduce((s, t) => s + t.durationMs, 0),
    inputTokens: turns.reduce((s, t) => s + (t.usage?.inputTokens ?? 0), 0),
    outputTokens: turns.reduce((s, t) => s + (t.usage?.outputTokens ?? 0), 0),
    deltas: events.filter((e) => e.event === "chat.delta").length,
    providerRetries: events.filter((e) => e.event === "provider.retry").length,
    guards: events
      .filter((e) => e.event === "loop.guard")
      .reduce<Record<string, number>>((acc, e) => {
        const kind = String(e.payload.kind ?? "?");
        acc[kind] = (acc[kind] ?? 0) + 1;
        return acc;
      }, {}),
  };
}
