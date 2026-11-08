import { decideApproval, toRecord } from "./policy.js";
import { callSignature, extractToolCalls } from "./metrics.js";
import { EvalClient } from "./client.js";
import type { TuiHandle } from "../../../packages/app-tui/src/eval/mountTui.js";
import type { ApprovalRecord, RecordedEvent, TurnOutcome } from "./types.js";

export type SessionOptions = {
  url: string;
  workspace: string;
  sessionKey: string;
  approvalMode: "auto" | "yolo";
  turnTimeoutMs: number;
  /** Across all turns of the scenario. */
  maxToolCalls: number;
  /** Identical consecutive calls before the runner cuts the turn (default 8, above the harness's own repeat guard so that fires first). */
  loopLimit?: number;
  /**
   * "gateway" talks to the gateway directly. "tui" types into the real TUI instead, so approvals are
   * answered with the y/n keys and a cut turn is Esc — the UI paths a person would use.
   */
  driver?: "gateway" | "tui";
};

/**
 * One conversation with the agent through the gateway, the same RPCs the TUI uses (chat.send,
 * tools.approve, chat.cancel). Records every event, answers approval prompts through the policy,
 * and cuts a turn that runs past its time, its tool budget or into a loop.
 */
export class AgentSession {
  readonly events: RecordedEvent[] = [];
  readonly approvals: ApprovalRecord[] = [];
  readonly turns: TurnOutcome[] = [];
  private client = new EvalClient();
  private cancelReason: TurnOutcome["cancelled"] = null;
  private stop: (() => void) | null = null;

  constructor(private readonly options: SessionOptions) {}

  private tui: TuiHandle | null = null;
  private finalText = "";
  private finalUsage: TurnOutcome["usage"];
  private waitForFinal: (() => void) | null = null;

  async start(): Promise<void> {
    const { url, sessionKey, approvalMode, driver } = this.options;
    await this.client.connect(url);
    this.stop = this.client.onEvent((e) => this.onEvent(e));
    await this.client.call("tools.setApprovalMode", { sessionKey, mode: approvalMode });
    if (driver === "tui") {
      const { mountTui } = await import("../../../packages/app-tui/src/eval/mountTui.js");
      this.externalApprovals = true;
      this.tui = mountTui({ gatewayUrl: url, sessionKey });
      await this.waitFor(() => this.tui!.screen().join("\n").includes("agent:"), "the TUI to connect", 20_000);
    }
  }

  /** The TUI's current screen, for the transcript. */
  screen(): string[] | null {
    return this.tui?.screen() ?? null;
  }

  private async waitFor(cond: () => boolean, what: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (cond()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`timed out waiting for ${what}`);
  }

  /** The TUI shows an approval prompt for the tool, then the "user" presses y or n like a person would. */
  private async answerInTui(toolName: string, approved: boolean): Promise<void> {
    const tui = this.tui;
    if (!tui) return;
    try {
      await this.waitFor(() => tui.screen().join("\n").includes(toolName), `the approval prompt for ${toolName}`, 5000);
    } catch {
      // The prompt may already be gone (cancelled turn); pressing anyway is harmless.
    }
    tui.press(approved ? "y" : "n");
  }

  /** The prompt a TUI user would see, answered by the policy. Exposed so the TUI driver can reuse the decision. */
  decide(req: { toolName: string; args: Record<string, unknown>; riskLevel?: string }) {
    const decision = decideApproval(this.options.workspace, req);
    this.approvals.push(toRecord(req, decision, Date.now()));
    return decision;
  }

  /** When true the runner leaves approvals to someone else (the TUI driver presses y/n itself). */
  externalApprovals = false;

  private onEvent(e: RecordedEvent): void {
    this.events.push(e);
    // The harness refuses the 4th identical call and stops a model that keeps insisting; this cut is only the last
    // resort behind it, so it must sit well above those thresholds or it pre-empts them.
    const { sessionKey, maxToolCalls, loopLimit = 8 } = this.options;
    const forThisSession = !e.payload.sessionKey || e.payload.sessionKey === sessionKey;
    if (!forThisSession) return;

    if (e.event === "chat.final") {
      this.finalText = String(e.payload.text ?? "");
      this.finalUsage = e.payload.usage as TurnOutcome["usage"];
      this.waitForFinal?.();
    }

    if (e.event === "tool.approval.requested" && this.externalApprovals) {
      const decision = this.decide({
        toolName: String(e.payload.toolName),
        args: (e.payload.args as Record<string, unknown>) ?? {},
        riskLevel: e.payload.riskLevel as string | undefined,
      });
      void this.answerInTui(String(e.payload.toolName), decision.approved);
      return;
    }

    if (e.event === "tool.approval.requested" && !this.externalApprovals) {
      const requestId = String(e.payload.requestId);
      const decision = this.decide({
        toolName: String(e.payload.toolName),
        args: (e.payload.args as Record<string, unknown>) ?? {},
        riskLevel: e.payload.riskLevel as string | undefined,
      });
      void this.client.call("tools.approve", { requestId, approved: decision.approved }).catch(() => {});
      return;
    }

    if (e.event === "tool.execute" && (e.payload.status === "ok" || e.payload.status === "error")) {
      const calls = extractToolCalls(this.events);
      if (calls.length > maxToolCalls) this.cancel("tool-budget");
      else if (this.tailRepeats(calls.map(callSignature), loopLimit)) this.cancel("loop");
    }
  }

  private tailRepeats(signatures: string[], limit: number): boolean {
    if (signatures.length < limit) return false;
    const tail = signatures.slice(-limit);
    return tail.every((s) => s === tail[0]);
  }

  private cancel(reason: NonNullable<TurnOutcome["cancelled"]>): void {
    if (this.cancelReason) return;
    this.cancelReason = reason;
    // Through the TUI a cut is the Esc key; otherwise the same RPC Esc triggers.
    if (this.tui) this.tui.press("\u001B");
    else void this.client.call("chat.cancel", { sessionKey: this.options.sessionKey }).catch(() => {});
  }

  async send(prompt: string): Promise<TurnOutcome> {
    const { sessionKey, turnTimeoutMs } = this.options;
    this.cancelReason = null;
    const started = Date.now();
    const timer = setTimeout(() => this.cancel("timeout"), turnTimeoutMs);
    let outcome: TurnOutcome;
    try {
      let reply: string;
      let usage: TurnOutcome["usage"];
      if (this.tui) {
        this.finalText = "";
        this.finalUsage = undefined;
        const finished = new Promise<void>((resolve) => {
          this.waitForFinal = resolve;
        });
        await this.tui.submit(prompt);
        await finished;
        this.waitForFinal = null;
        reply = this.finalText;
        usage = this.finalUsage;
      } else {
        const result = await this.client.call<{ reply: string; usage?: TurnOutcome["usage"] }>("chat.send", {
          message: prompt,
          sessionKey,
          channelId: "tui",
        });
        reply = result.reply ?? "";
        usage = result.usage;
      }
      outcome = { prompt, reply, durationMs: Date.now() - started, cancelled: this.cancelReason, usage };
    } catch (err) {
      outcome = { prompt, reply: "", durationMs: Date.now() - started, cancelled: this.cancelReason, error: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timer);
    }
    this.turns.push(outcome);
    return outcome;
  }

  async close(): Promise<void> {
    this.tui?.unmount();
    this.stop?.();
    this.client.close();
  }
}
