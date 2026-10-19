import { EventEmitter } from "node:events";
import WebSocket from "ws";
import type {
  ApprovalModeChangedPayload,
  ChatDeltaPayload,
  ChatFinalPayload,
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
  "turn.start": [TurnStartPayload];
  "turn.end": [TurnEndPayload];
  "tool.execute": [ToolExecutePayload];
  "tool.approval.requested": [ToolApprovalRequestedPayload];
  "tool.approval.resolved": [ToolApprovalResolvedPayload];
  "tools.approvalMode.changed": [ApprovalModeChangedPayload];
  connected: [];
  disconnected: [];
  error: [Error];
}

export class GatewayClient extends EventEmitter<GatewayClientEvents> {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private url: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = true;
  private _connected = false;

  constructor(url: string) {
    super();
    this.url = url;
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

      ws.on("open", () => {
        this.ws = ws;
        this._connected = true;
        this.emit("connected");
        resolve();
      });

      ws.on("message", (data: WebSocket.RawData) => {
        this.handleMessage(String(data));
      });

      ws.on("close", () => {
        this._connected = false;
        this.ws = null;
        this.emit("disconnected");
        this.scheduleReconnect();
      });

      ws.on("error", (err) => {
        if (!this._connected) {
          reject(err);
        } else {
          this.emit("error", err instanceof Error ? err : new Error(String(err)));
        }
      });
    });
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
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;
    this.reconnectTimer = setTimeout(() => {
      this.doConnect().catch((err) => {
        this.emit("error", err instanceof Error ? err : new Error(String(err)));
        this.scheduleReconnect();
      });
    }, 2000);
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
        cleanup();
        reject(new Error(`RPC timeout: ${method}`));
      }, timeoutMs);

      const onMessage = (data: WebSocket.RawData) => {
        let msg: WsIncoming;
        try {
          msg = JSON.parse(String(data)) as WsIncoming;
        } catch {
          return;
        }
        if ("type" in msg && msg.type === "event") return;
        const rpc = msg as RpcResponse;
        if (rpc.id !== id) return;
        cleanup();
        if (rpc.error) {
          reject(new Error(`${rpc.error.code}: ${rpc.error.message}`));
        } else {
          resolve(rpc.result as T);
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        ws.off("message", onMessage);
      };

      ws.on("message", onMessage);
      ws.send(JSON.stringify({ id, method, params }));
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
  }
}
