export type GatewayWsEvent = {
  event: string;
  payload: unknown;
};

/**
 * "reconnected" fires after a socket that had already been open dropped and
 * a fresh one came back up — never for the first connect() (that resolves
 * the connect() promise instead). The gateway forgets per-socket state
 * (auth, device-tool registrations) on close, so listeners must redo their
 * handshake on "reconnected", not just flip a flag.
 */
export type GatewayConnectionStatus = "closed" | "reconnected";

type WsIncoming =
  | { id?: number; result?: unknown; error?: { code: string; message: string } }
  | { type: "event"; event: string; payload: unknown };

// Backoff for the automatic reconnect after an established socket drops.
// The first retry is fast because the common case (desktop app: Electron's
// network service dropped the loopback socket across a macOS sleep/wake
// while the gateway subprocess is still perfectly alive) reconnects on the
// first try; the cap keeps a genuinely-dead gateway from being hammered.
const RECONNECT_BASE_DELAY_MS = 500;
const RECONNECT_MAX_DELAY_MS = 5_000;

export class GatewayClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private eventHandlers = new Set<(ev: GatewayWsEvent) => void>();
  private statusHandlers = new Set<(status: GatewayConnectionStatus) => void>();
  // Every in-flight call()'s rejecter — so a socket dropping mid-request
  // fails those requests right away instead of letting each one sit out its
  // full timeout against a socket that can never answer.
  private pendingRejects = new Set<(err: Error) => void>();
  // A socket still in CONNECTING — close() must abort it too, or a
  // connect() abandoned mid-handshake (React StrictMode's dev-only
  // mount/unmount/mount, a provider remount) leaks an orphaned open socket.
  private pendingSocket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private everOpened = false;
  private closedByUser = false;

  constructor(private readonly wsUrl: string) {}

  onEvent(handler: (ev: GatewayWsEvent) => void): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  onStatus(handler: (status: GatewayConnectionStatus) => void): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  async connect(): Promise<void> {
    this.closedByUser = false;
    if (this.isOpen) return;
    await this.openSocket();
  }

  private openSocket(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      let settled = false;
      ws.onopen = () => {
        settled = true;
        this.ws = ws;
        this.pendingSocket = null;
        this.reconnectAttempt = 0;
        ws.onmessage = (msg) => {
          try {
            const data = JSON.parse(String(msg.data)) as WsIncoming;
            if ("type" in data && data.type === "event") {
              const ev = { event: data.event, payload: data.payload };
              for (const h of this.eventHandlers) h(ev);
            }
          } catch {
            /* ignore */
          }
        };
        const isReconnect = this.everOpened;
        this.everOpened = true;
        if (isReconnect) this.emitStatus("reconnected");
        resolve();
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error("WebSocket connection failed"));
        }
      };
      // Fires after onerror on a failed connect, and on its own when an
      // established socket drops (gateway restart, OS sleep/wake, network
      // reset). Without this the client kept pointing at a CLOSED socket
      // forever: WebSocket.send() on a CLOSED socket silently discards, so
      // every call() just sat out its timeout with no way to recover.
      ws.onclose = () => {
        if (this.pendingSocket === ws) this.pendingSocket = null;
        const wasCurrent = this.ws === ws;
        if (wasCurrent) {
          this.ws = null;
          this.rejectPending(new Error("Gateway connection closed"));
          this.emitStatus("closed");
        }
        if (!settled) {
          settled = true;
          reject(new Error("WebSocket connection failed"));
        }
        // Only once a socket has ever been open does a close auto-reconnect
        // (covers both an established socket dropping and a failed retry);
        // a first connect() that never opened rejects to its caller instead.
        if (this.everOpened) this.scheduleReconnect();
      };
      this.pendingSocket = ws;
    });
  }

  private scheduleReconnect(): void {
    if (this.closedByUser || this.reconnectTimer !== null) return;
    const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempt, RECONNECT_MAX_DELAY_MS);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.closedByUser || this.isOpen) return;
      // A failed attempt fires onclose (after onerror), which schedules the
      // next try with a longer delay — nothing to do in the catch itself.
      this.openSocket().catch(() => undefined);
    }, delay);
  }

  private emitStatus(status: GatewayConnectionStatus): void {
    for (const h of this.statusHandlers) h(status);
  }

  private rejectPending(err: Error): void {
    const rejects = [...this.pendingRejects];
    this.pendingRejects.clear();
    for (const reject of rejects) reject(err);
  }

  async auth(apiKey: string): Promise<void> {
    await this.call("auth", { apiKey });
  }

  async call<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    options?: { collectEvents?: boolean; timeoutMs?: number },
  ): Promise<{ result: T; events: GatewayWsEvent[] }> {
    const ws = this.ws;
    // readyState check, not just null: between the socket dropping and its
    // onclose running (or a CLOSING socket) send() would silently discard.
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error("Not connected");

    const id = this.nextId++;
    const collectEvents = options?.collectEvents ?? false;
    const timeoutMs = options?.timeoutMs ?? 30_000;
    const events: GatewayWsEvent[] = [];

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout: ${method}`));
      }, timeoutMs);

      const onMessage = (msg: MessageEvent) => {
        const data = JSON.parse(String(msg.data)) as WsIncoming;
        if ("type" in data && data.type === "event" && collectEvents) {
          events.push({ event: data.event, payload: data.payload });
          return;
        }
        if (!("id" in data) || data.id !== id) return;
        if (data.error) {
          cleanup();
          reject(new Error(`${data.error.code}: ${data.error.message}`));
          return;
        }
        cleanup();
        resolve({ result: data.result as T, events });
      };

      const rejectOnClose = (err: Error) => {
        cleanup();
        reject(err);
      };

      const cleanup = () => {
        clearTimeout(timer);
        ws.removeEventListener("message", onMessage);
        this.pendingRejects.delete(rejectOnClose);
      };

      this.pendingRejects.add(rejectOnClose);
      ws.addEventListener("message", onMessage);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    const pending = this.pendingSocket;
    this.pendingSocket = null;
    pending?.close();
    this.rejectPending(new Error("Gateway connection closed"));
  }
}

export function defaultWsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}`;
}

export const API_KEY_STORAGE = "yggdrasil.apiKey";
