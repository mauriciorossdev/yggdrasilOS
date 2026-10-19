import WebSocket from "ws";

export type GatewayWsEvent = {
  event: string;
  payload: unknown;
};

export type GatewayCallResult<T = unknown> = {
  result: T;
  events: GatewayWsEvent[];
};

type WsIncoming =
  | { id?: number; result?: unknown; error?: { code: string; message: string } }
  | { type: "event"; event: string; payload: unknown };

export class GatewayWsClient {
  private ws: WebSocket | null = null;
  private nextId = 1;

  async connect(url: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.on("open", () => {
        this.ws = ws;
        resolve();
      });
      ws.on("error", reject);
    });
  }

  async call<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    options?: { collectEvents?: boolean; timeoutMs?: number },
  ): Promise<GatewayCallResult<T>> {
    const ws = this.ws;
    if (!ws) throw new Error("GatewayWsClient not connected");

    const id = this.nextId++;
    const collectEvents = options?.collectEvents ?? false;
    const timeoutMs = options?.timeoutMs ?? 15_000;
    const events: GatewayWsEvent[] = [];

    return new Promise<GatewayCallResult<T>>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Gateway call timed out: ${method}`));
      }, timeoutMs);

      const onMessage = (data: WebSocket.RawData) => {
        const msg = JSON.parse(String(data)) as WsIncoming;
        if ("type" in msg && msg.type === "event" && collectEvents) {
          events.push({ event: msg.event, payload: msg.payload });
          return;
        }
        if (!("id" in msg) || msg.id !== id) return;
        if (msg.error) {
          cleanup();
          reject(new Error(`${msg.error.code}: ${msg.error.message}`));
          return;
        }
        if ("result" in msg) {
          cleanup();
          resolve({ result: msg.result as T, events });
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

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
