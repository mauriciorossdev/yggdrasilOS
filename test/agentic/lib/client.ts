import WebSocket from "ws";
import type { RecordedEvent } from "./types.js";

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

/** Minimal gateway client: RPC calls plus a firehose of every event, with timestamps. */
export class EvalClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private listeners = new Set<(e: RecordedEvent) => void>();
  private startedAt = Date.now();

  async connect(url: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.on("open", () => {
        this.ws = ws;
        resolve();
      });
      ws.on("error", reject);
      ws.on("message", (data) => this.onMessage(String(data)));
      ws.on("close", () => {
        for (const p of this.pending.values()) p.reject(new Error("gateway connection closed"));
        this.pending.clear();
      });
    });
  }

  private onMessage(raw: string): void {
    const msg = JSON.parse(raw) as { id?: number; result?: unknown; error?: { code: string; message: string }; type?: string; event?: string; payload?: unknown };
    if (msg.type === "event") {
      const event: RecordedEvent = {
        t: Date.now() - this.startedAt,
        event: String(msg.event),
        payload: (msg.payload as Record<string, unknown>) ?? {},
      };
      for (const l of this.listeners) l(event);
      return;
    }
    if (msg.id === undefined) return;
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.error) p.reject(new Error(`${msg.error.code}: ${msg.error.message}`));
    else p.resolve(msg.result);
  }

  onEvent(listener: (e: RecordedEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const ws = this.ws;
    if (!ws) return Promise.reject(new Error("not connected"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    this.ws?.close();
  }
}
