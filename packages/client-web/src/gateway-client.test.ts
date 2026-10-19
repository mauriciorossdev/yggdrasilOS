import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GatewayClient, type GatewayConnectionStatus } from "./gateway-client.js";

// Minimal stand-in for the browser WebSocket: enough surface for
// gateway-client.ts (readyState, on* handlers, add/removeEventListener for
// "message", send/close) plus test hooks to drive open/close/reply.
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((msg: { data: string }) => void) | null = null;
  private messageListeners = new Set<(msg: { data: string }) => void>();

  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (msg: { data: string }) => void): void {
    if (type === "message") this.messageListeners.add(listener);
  }

  removeEventListener(type: string, listener: (msg: { data: string }) => void): void {
    if (type === "message") this.messageListeners.delete(listener);
  }

  send(data: string): void {
    // Real sockets silently discard on CLOSED — mirror that, since the
    // client is expected to never get here on a non-OPEN socket.
    if (this.readyState === FakeWebSocket.OPEN) this.sent.push(data);
  }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  // --- test drivers ---
  simulateOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  simulateFailedConnect(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onerror?.();
    this.onclose?.();
  }

  /** The peer/OS dropped an established socket (not a local close()). */
  simulateDrop(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  reply(id: number, result: unknown): void {
    const msg = { data: JSON.stringify({ id, result }) };
    this.onmessage?.(msg);
    for (const l of this.messageListeners) l(msg);
  }

  lastRequest(): { id: number; method: string; params: Record<string, unknown> } {
    return JSON.parse(this.sent[this.sent.length - 1]!) as { id: number; method: string; params: Record<string, unknown> };
  }
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function connectedClient(): Promise<{ client: GatewayClient; ws: FakeWebSocket; statuses: GatewayConnectionStatus[] }> {
  const client = new GatewayClient("ws://127.0.0.1:1");
  const statuses: GatewayConnectionStatus[] = [];
  client.onStatus((s) => statuses.push(s));
  const connecting = client.connect();
  const ws = FakeWebSocket.instances[0]!;
  ws.simulateOpen();
  await connecting;
  return { client, ws, statuses };
}

describe("gateway-client", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("constructs with ws url", () => {
    const client = new GatewayClient("ws://127.0.0.1:18789");
    expect(client).toBeInstanceOf(GatewayClient);
  });

  it("call() rejects immediately when never connected", async () => {
    const client = new GatewayClient("ws://127.0.0.1:1");
    await expect(client.call("health")).rejects.toThrow("Not connected");
  });

  it("first connect() failing rejects and does not auto-reconnect", async () => {
    const client = new GatewayClient("ws://127.0.0.1:1");
    const connecting = client.connect();
    FakeWebSocket.instances[0]!.simulateFailedConnect();
    await expect(connecting).rejects.toThrow("WebSocket connection failed");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("resolves a call from the matching reply", async () => {
    const { client, ws } = await connectedClient();
    const pending = client.call<{ ok: boolean }>("health");
    const req = ws.lastRequest();
    expect(req.method).toBe("health");
    ws.reply(req.id, { ok: true });
    await expect(pending).resolves.toEqual({ result: { ok: true }, events: [] });
  });

  it("an established socket dropping fails in-flight calls at once, fails new calls fast, and reconnects", async () => {
    const { client, ws, statuses } = await connectedClient();
    const inFlight = client.call("fs.list", { relativePath: "" });

    ws.simulateDrop();

    await expect(inFlight).rejects.toThrow("Gateway connection closed");
    expect(statuses).toEqual(["closed"]);
    expect(client.isOpen).toBe(false);
    // No 30s silent timeout against a dead socket — the exact bug this
    // guards against (FileTree stuck on "Loading…" after a sleep/wake).
    await expect(client.call("fs.list", { relativePath: "" })).rejects.toThrow("Not connected");

    await vi.advanceTimersByTimeAsync(500);
    expect(FakeWebSocket.instances).toHaveLength(2);
    const ws2 = FakeWebSocket.instances[1]!;
    ws2.simulateOpen();
    await flush();

    expect(statuses).toEqual(["closed", "reconnected"]);
    expect(client.isOpen).toBe(true);
    const pending = client.call("fs.list", { relativePath: "notes" });
    ws2.reply(ws2.lastRequest().id, { entries: [] });
    await expect(pending).resolves.toEqual({ result: { entries: [] }, events: [] });
  });

  it("backs off between failed reconnect attempts and caps the delay", async () => {
    const { ws } = await connectedClient();
    ws.simulateDrop();

    // 500 → 1000 → 2000 → 4000 → 5000 (cap) → 5000
    const expectedDelays = [500, 1000, 2000, 4000, 5000, 5000];
    for (const [i, delay] of expectedDelays.entries()) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(FakeWebSocket.instances).toHaveLength(i + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(FakeWebSocket.instances).toHaveLength(i + 2);
      FakeWebSocket.instances[i + 1]!.simulateFailedConnect();
    }
  });

  it("event handlers survive a reconnect", async () => {
    const { client, ws } = await connectedClient();
    const seen: string[] = [];
    client.onEvent((ev) => seen.push(ev.event));

    ws.simulateDrop();
    await vi.advanceTimersByTimeAsync(500);
    const ws2 = FakeWebSocket.instances[1]!;
    ws2.simulateOpen();
    ws2.onmessage?.({ data: JSON.stringify({ type: "event", event: "fs.changed", payload: {} }) });

    expect(seen).toEqual(["fs.changed"]);
  });

  it("close() by the caller does not reconnect", async () => {
    const { client, ws, statuses } = await connectedClient();
    client.close();
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(statuses).toEqual([]);
  });

  it("close() while still connecting aborts that socket and rejects connect()", async () => {
    const client = new GatewayClient("ws://127.0.0.1:1");
    const connecting = client.connect();
    client.close();
    expect(FakeWebSocket.instances[0]!.readyState).toBe(FakeWebSocket.CLOSED);
    await expect(connecting).rejects.toThrow("WebSocket connection failed");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
