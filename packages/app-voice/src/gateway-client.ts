/**
 * Persistent WebSocket client to the Yggdrasil Gateway, used by the voice
 * app's HTTP routes (see server.ts) instead of the old channel-http
 * `/inbound` proxy that hf-realtime-voice's Python version used.
 *
 * Why: channel-http enforces a hard, non-configurable 30s reply timeout and
 * its approval gate is a TUI prompt with no remote hook. The Gateway's
 * `chat.send` RPC uses a *decoupled* approval mechanism instead — it emits a
 * `tool.approval.requested` event to every connected WS client and waits (up
 * to 60s server-side) for anyone to call the `tools.approve` RPC with the
 * matching requestId. This lets us surface the approval request back to the
 * browser (so the voice model can ask the user out loud) instead of blocking
 * on a terminal prompt.
 *
 * Ported from the original Python prototype (yggdrasil_client.py) — same
 * design, same method names where they translate 1:1.
 */

import { randomUUID } from "node:crypto";
import WebSocket from "ws";

export class ConnectionError extends Error {}
export class TimeoutError extends Error {}

type RpcResponse = { id: string; result?: unknown; error?: { code: string; message: string } };
type WsEvent = { type: "event"; event: string; payload?: Record<string, unknown> };
type WsIncoming = RpcResponse | WsEvent;

export type ApprovalPayload = {
  requestId: string;
  sessionKey: string;
  toolName: string;
  args: Record<string, unknown>;
  riskLevel?: "destructive" | "moderate" | "safe";
};

export type RaceOutcome =
  | { done: true; result: unknown }
  | { done: false; pendingApproval: ApprovalPayload };

const RECONNECT_DELAY_MS = 2000;

type PendingCall = { resolve: (v: unknown) => void; reject: (e: Error) => void };
type SessionCallEntry = { callId: string; promise: Promise<unknown> };

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(message)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e as Error); },
    );
  });
}

export class YggdrasilGatewayClient {
  private ws: WebSocket | null = null;
  private readonly pendingCalls = new Map<string, PendingCall>();
  // sessionKey -> most recent tool.approval.requested payload
  private readonly pendingApprovals = new Map<string, ApprovalPayload>();
  // sessionKey -> callback fired once an approval for that session arrives
  private readonly approvalWaiters = new Map<string, () => void>();
  // sessionKey -> the still-pending chat.send call, kept alive across the
  // HTTP round-trip so a later resolveApproval() can resume it.
  private readonly sessionCallFutures = new Map<string, SessionCallEntry>();

  constructor(private readonly url: string, private readonly apiKey = "") {}

  start(): void {
    void this.connectLoop();
  }

  private async connectLoop(): Promise<void> {
    for (;;) {
      try {
        await this.connectOnce();
      } catch {
        // connection failed to even open — fall through to reconnect delay
      }
      this.ws = null;
      this.failAllPending(new ConnectionError("Lost connection to the computer-control agent."));
      await new Promise((r) => setTimeout(r, RECONNECT_DELAY_MS));
    }
  }

  private connectOnce(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url);
      let opened = false;

      ws.on("open", () => {
        opened = true;
        this.ws = ws;
        if (this.apiKey) {
          this.call("auth", { apiKey: this.apiKey }, 10_000).catch(() => {
            // if auth genuinely is required and fails, subsequent calls
            // will surface a clear error from the server anyway
          });
        }
      });

      ws.on("message", (data) => this.handleMessage(String(data)));

      ws.on("close", () => {
        this.ws = null;
        resolve(); // connection ended cleanly (from either side) — reconnect
      });

      ws.on("error", (err) => {
        if (!opened) reject(err instanceof Error ? err : new Error(String(err)));
        // if already opened, the 'close' event follows and resolve() runs
      });
    });
  }

  private failAllPending(err: Error): void {
    for (const pending of this.pendingCalls.values()) pending.reject(err);
    this.pendingCalls.clear();
    // Note: sessionCallFutures holds promises whose settlement is driven by
    // pendingCalls above — rejecting here too keeps awaitPending() from
    // hanging forever if the connection dropped while an approval was
    // pending resolution.
    for (const entry of this.sessionCallFutures.values()) {
      const pending = this.pendingCalls.get(entry.callId);
      pending?.reject(err);
    }
    this.sessionCallFutures.clear();
  }

  private handleMessage(raw: string): void {
    let msg: WsIncoming;
    try {
      msg = JSON.parse(raw) as WsIncoming;
    } catch {
      return;
    }
    if ("type" in msg && msg.type === "event") {
      this.handleEvent(msg.event, msg.payload ?? {});
      return;
    }
    const rpc = msg as RpcResponse;
    const pending = this.pendingCalls.get(String(rpc.id));
    if (!pending) return;
    this.pendingCalls.delete(String(rpc.id));
    if (rpc.error) pending.reject(new Error(rpc.error.message));
    else pending.resolve(rpc.result);
  }

  private handleEvent(event: string, payload: Record<string, unknown>): void {
    if (event === "tool.approval.requested") {
      const sessionKey = String(payload.sessionKey ?? "");
      if (!sessionKey) return;
      this.pendingApprovals.set(sessionKey, payload as unknown as ApprovalPayload);
      this.approvalWaiters.get(sessionKey)?.();
    } else if (event === "tool.approval.resolved") {
      const sessionKey = String(payload.sessionKey ?? "");
      const existing = this.pendingApprovals.get(sessionKey);
      if (existing && existing.requestId === payload.requestId) {
        this.pendingApprovals.delete(sessionKey);
      }
    }
  }

  private rawCall(method: string, params: Record<string, unknown>): { callId: string; promise: Promise<unknown> } {
    if (!this.ws) throw new ConnectionError("Not connected to the computer-control agent.");
    const callId = randomUUID();
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pendingCalls.set(callId, { resolve, reject });
    });
    this.ws.send(JSON.stringify({ method, params, id: callId }));
    return { callId, promise };
  }

  async call(method: string, params: Record<string, unknown> = {}, timeoutMs = 90_000): Promise<unknown> {
    const { callId, promise } = this.rawCall(method, params);
    try {
      return await withTimeout(promise, timeoutMs, `Timed out calling ${method}.`);
    } finally {
      this.pendingCalls.delete(callId);
    }
  }

  /**
   * Await a call, but return early if a tool.approval.requested event for
   * this sessionKey arrives first. A single instruction can trigger *several*
   * approval-gated tool calls in a row (e.g. the model tries fs_delete, then
   * shell_exec to verify, then fs_delete again) — call resolveApproval() then
   * awaitPending() as many times as needed until {done: true} comes back.
   */
  async callRacingApproval(
    method: string,
    params: Record<string, unknown>,
    sessionKey: string,
    timeoutMs = 90_000,
  ): Promise<RaceOutcome> {
    const { callId, promise } = this.rawCall(method, params);
    return this.raceFutOrApproval(callId, promise, sessionKey, timeoutMs);
  }

  /** Resolve a pending approval (tools.approve), separate from resuming the
   * underlying call — see server.ts for the two-step HTTP flow this backs. */
  async resolveApproval(requestId: string, approved: boolean, timeoutMs = 15_000): Promise<void> {
    await this.call("tools.approve", { requestId, approved }, timeoutMs);
  }

  /** Resume the chat.send call a prior callRacingApproval() (or a previous
   * awaitPending()) left pending for this session, once its approval has
   * been resolved. May itself return another pendingApproval. */
  async awaitPending(sessionKey: string, timeoutMs = 90_000): Promise<RaceOutcome> {
    const entry = this.sessionCallFutures.get(sessionKey);
    if (!entry) throw new Error(`No pending computer_task call for session ${sessionKey}.`);
    this.sessionCallFutures.delete(sessionKey);
    return this.raceFutOrApproval(entry.callId, entry.promise, sessionKey, timeoutMs);
  }

  private raceFutOrApproval(
    callId: string,
    promise: Promise<unknown>,
    sessionKey: string,
    timeoutMs: number,
  ): Promise<RaceOutcome> {
    return new Promise<RaceOutcome>((resolve, reject) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.approvalWaiters.delete(sessionKey);
        this.pendingCalls.delete(callId);
        reject(new TimeoutError("Timed out waiting for a reply from the computer-control agent."));
      }, timeoutMs);

      this.approvalWaiters.set(sessionKey, () => {
        if (settled) return;
        const approval = this.pendingApprovals.get(sessionKey);
        if (!approval) return;
        settled = true;
        clearTimeout(timer);
        this.approvalWaiters.delete(sessionKey);
        this.pendingApprovals.delete(sessionKey);
        this.sessionCallFutures.set(sessionKey, { callId, promise });
        resolve({ done: false, pendingApproval: approval });
      });

      promise.then(
        (result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.approvalWaiters.delete(sessionKey);
          this.pendingCalls.delete(callId);
          resolve({ done: true, result });
        },
        (err: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.approvalWaiters.delete(sessionKey);
          this.pendingCalls.delete(callId);
          reject(err);
        },
      );
    });
  }
}
