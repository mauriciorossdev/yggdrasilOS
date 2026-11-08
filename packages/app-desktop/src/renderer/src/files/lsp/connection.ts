/** Monaco only ignores a failed request as "just cancelled" when both name and message are exactly this. */
const CANCELED = "Canceled";

function toError(error: { code?: number; message?: string }): Error {
  if (error.code === undefined || !CANCELLED_CODES.has(error.code)) return new Error(error.message ?? "language server error");
  const cancelled = new Error(CANCELED);
  cancelled.name = CANCELED;
  return cancelled;
}

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };
type RequestHandler = (params: unknown) => unknown;
type NotificationHandler = (params: unknown) => void;

const METHOD_NOT_FOUND = -32601;
const CANCELLED_CODES = new Set([-32800, -32802]);
const REQUEST_FAILED = -32803;

/** JSON-RPC over one language server session. `post` delivers a message to the server. */
export class LspConnection {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly requestHandlers = new Map<string, RequestHandler>();
  private readonly notificationHandlers = new Map<string, NotificationHandler>();
  private closed = false;

  constructor(private readonly post: (message: unknown) => void) {}

  request<T>(method: string, params?: unknown, token?: { onCancellationRequested: (listener: () => void) => unknown }): Promise<T> {
    if (this.closed) return Promise.reject(new Error("language server closed"));
    const id = this.nextId++;
    const result = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    });
    token?.onCancellationRequested(() => {
      if (this.pending.has(id)) this.notify("$/cancelRequest", { id });
    });
    this.post({ jsonrpc: "2.0", id, method, params });
    return result;
  }

  notify(method: string, params?: unknown): void {
    if (!this.closed) this.post({ jsonrpc: "2.0", method, params });
  }

  onRequest(method: string, handler: RequestHandler): void {
    this.requestHandlers.set(method, handler);
  }

  onNotification(method: string, handler: NotificationHandler): void {
    this.notificationHandlers.set(method, handler);
  }

  /** Handles a message from the server. */
  receive(raw: unknown): void {
    const message = raw as { id?: number | string; method?: string; params?: unknown; result?: unknown; error?: { code?: number; message?: string } };
    if (message.method === undefined) {
      const pending = typeof message.id === "number" ? this.pending.get(message.id) : undefined;
      if (!pending) return;
      this.pending.delete(message.id as number);
      if (message.error) pending.reject(toError(message.error));
      else pending.resolve(message.result ?? null);
      return;
    }
    if (message.id === undefined) {
      this.notificationHandlers.get(message.method)?.(message.params);
      return;
    }
    void this.answer(message.id, message.method, message.params);
  }

  private async answer(id: number | string, method: string, params: unknown): Promise<void> {
    const handler = this.requestHandlers.get(method);
    if (!handler) {
      this.post({ jsonrpc: "2.0", id, error: { code: METHOD_NOT_FOUND, message: `Not handled: ${method}` } });
      return;
    }
    try {
      this.post({ jsonrpc: "2.0", id, result: (await handler(params)) ?? null });
    } catch (err) {
      this.post({ jsonrpc: "2.0", id, error: { code: REQUEST_FAILED, message: err instanceof Error ? err.message : String(err) } });
    }
  }

  /** The server is gone: fail whatever was waiting on it, and send nothing more. */
  close(): void {
    this.closed = true;
    for (const pending of this.pending.values()) pending.reject(new Error("language server closed"));
    this.pending.clear();
  }
}
