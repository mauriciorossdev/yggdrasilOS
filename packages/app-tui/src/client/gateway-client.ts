import { EventEmitter } from "node:events";
import WebSocket from "ws";
import type {
  ApprovalModeChangedPayload,
  ChatDeltaPayload,
  ChatFinalPayload,
  ProviderRetryPayload,
  RpcResponse,
  ToolApprovalRequestedPayload,
  ToolApprovalResolvedPayload,
  ToolExecutePayload,
  TurnEndPayload,
  TurnStartPayload,
  WsEvent,
  WsIncoming,
} from "./types.js";

export interface GatewayClientEvents {
  "chat.delta": [ChatDeltaPayload];
  "chat.final": [ChatFinalPayload];
  "provider.retry": [ProviderRetryPayload];
  "turn.start": [TurnStartPayload];
  "turn.end": [TurnEndPayload];
  "tool.execute": [ToolExecutePayload];
  "tool.approval.requested": [ToolApprovalRequestedPayload];
  "tool.approval.resolved": [ToolApprovalResolvedPayload];
  "tools.approvalMode.changed": [ApprovalModeChangedPayload];
  connected: [];
  /** Fired after `connected` when this is a re-establishment of a dropped socket, not the first connect. */
  reconnected: [];
  disconnected: [];
  error: [Error];
}

export type GatewayClientOptions = {
  /** Gateway API key; defaults to YGGDRASIL_API_KEY. Sent via the `auth` RPC on every (re)connect. */
  apiKey?: string;
  reconnectDelayMs?: number;
};

type Pending = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** Thrown for every RPC that was in flight when the socket dropped. */
export class ConnectionLostError extends Error {
  constructor(method: string) {
    super(`Connection to the gateway was lost during ${method}`);
    this.name = "ConnectionLostError";
  }
}

export class GatewayAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayAuthError";
  }
}

export class GatewayClient extends EventEmitter<GatewayClientEvents> {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private url: string;
  private apiKey: string | undefined;
  private reconnectDelayMs: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = true;
  private _connected = false;
  private hasConnectedBefore = false;
  // One socket-level message listener routes responses to these, instead of
  // one listener per call (which also leaked past the socket's lifetime).
  private pending = new Map<number, Pending>();

  constructor(url: string, options: GatewayClientOptions = {}) {
    super();
    this.url = url;
    this.apiKey = options.apiKey?.trim() || process.env.YGGDRASIL_API_KEY?.trim() || undefined;
    this.reconnectDelayMs = options.reconnectDelayMs ?? 2000;
  }

  get connected(): boolean {
    return this._connected;
  }

  async connect(): Promise<void> {
    this.shouldReconnect = true;
    await this.doConnect();
  }

  private async doConnect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url);
      let opened = false;

      ws.on("open", () => {
        opened = true;
        this.ws = ws;
        void this.authenticate().then(
          () => {
            this._connected = true;
            const again = this.hasConnectedBefore;
            this.hasConnectedBefore = true;
            this.emit("connected");
            if (again) this.emit("reconnected");
            resolve();
          },
          (err: unknown) => {
            // A rejected key will be rejected again — retrying forever only spams the gateway.
            this.shouldReconnect = false;
            ws.close();
            reject(err);
          },
        );
      });

      ws.on("message", (data: WebSocket.RawData) => {
        this.handleMessage(String(data));
      });

      ws.on("close", () => {
        const wasConnected = this._connected;
        this._connected = false;
        if (this.ws === ws) this.ws = null;
        this.rejectAllPending();
        if (wasConnected) this.emit("disconnected");
        if (opened || wasConnected) this.scheduleReconnect();
      });

      ws.on("error", (err) => {
        if (!opened) {
          reject(err);
        } else if (this._connected) {
          this.emit("error", err instanceof Error ? err : new Error(String(err)));
        }
      });
    });
  }

  /** Sends the API key if there is one. A gateway that already trusts this socket answers with a non-auth error, which is fine. */
  private async authenticate(): Promise<void> {
    if (!this.apiKey) return;
    try {
      await this.call("auth", { apiKey: this.apiKey }, 10_000);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith("UNAUTHORIZED")) {
        throw new GatewayAuthError("The gateway rejected the API key (YGGDRASIL_API_KEY / --api-key).");
      }
      if (err instanceof ConnectionLostError) throw err;
      // Anything else (e.g. "unknown method auth" on an already-trusted local socket): carry on.
    }
  }

  private handleMessage(raw: string): void {
    let msg: WsIncoming;
    try {
      msg = JSON.parse(raw) as WsIncoming;
    } catch {
      return;
    }

    if ("type" in msg && msg.type === "event") {
      const evt = msg as WsEvent;
      this.emit(evt.event as keyof GatewayClientEvents, evt.payload as never);
      return;
    }

    const rpc = msg as RpcResponse;
    const entry = this.pending.get(rpc.id);
    if (!entry) return;
    this.pending.delete(rpc.id);
    clearTimeout(entry.timer);
    if (rpc.error) {
      entry.reject(new Error(`${rpc.error.code}: ${rpc.error.message}`));
    } else {
      entry.resolve(rpc.result);
    }
  }

  private rejectAllPending(): void {
    const entries = [...this.pending.values()];
    this.pending.clear();
    for (const entry of entries) {
      clearTimeout(entry.timer);
      entry.reject(new ConnectionLostError(entry.method));
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.doConnect().catch((err) => {
        if (err instanceof GatewayAuthError) {
          this.emit("error", err);
          return;
        }
        this.emit("error", err instanceof Error ? err : new Error(String(err)));
        this.scheduleReconnect();
      });
    }, this.reconnectDelayMs);
  }

  async call<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 30_000,
  ): Promise<T> {
    const ws = this.ws;
    if (!ws) throw new Error("Not connected to gateway");

    const id = this.nextId++;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve: resolve as (v: unknown) => void, reject, timer });
      ws.send(JSON.stringify({ id, method, params }), (err) => {
        if (!err) return;
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this._connected = false;
    this.rejectAllPending();
  }
}
