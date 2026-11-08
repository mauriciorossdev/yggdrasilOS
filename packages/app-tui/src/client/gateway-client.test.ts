import { afterEach, describe, expect, it } from "vitest";
import { type AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket as ServerSocket } from "ws";
import { ConnectionLostError, GatewayAuthError, GatewayClient } from "./gateway-client.js";

let server: WebSocketServer | null = null;
let client: GatewayClient | null = null;

async function startServer(onConnection: (ws: ServerSocket) => void): Promise<string> {
  server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  server.on("connection", onConnection);
  await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
  return `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function waitFor<T>(emitter: GatewayClient, event: "connected" | "reconnected" | "disconnected" | "error"): Promise<T> {
  return new Promise((resolve) => emitter.once(event, ((v: T) => resolve(v)) as never));
}

afterEach(async () => {
  client?.disconnect();
  client = null;
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
});

describe("GatewayClient", () => {
  it("routes responses to the call that asked, even out of order", async () => {
    const url = await startServer((ws) => {
      const requests: Array<{ id: number; method: string }> = [];
      ws.on("message", (data) => {
        requests.push(JSON.parse(String(data)));
        if (requests.length < 2) return;
        // Answer the second request first.
        for (const r of [...requests].reverse()) ws.send(JSON.stringify({ id: r.id, result: { echo: r.method } }));
      });
    });
    client = new GatewayClient(url, { apiKey: "" });
    await client.connect();
    const [a, b] = await Promise.all([client.call("one"), client.call("two")]);
    expect(a).toEqual({ echo: "one" });
    expect(b).toEqual({ echo: "two" });
  });

  it("rejects in-flight calls immediately when the socket drops", async () => {
    const url = await startServer((ws) => {
      ws.on("message", () => ws.terminate());
    });
    client = new GatewayClient(url, { apiKey: "", reconnectDelayMs: 60_000 });
    await client.connect();
    await expect(client.call("chat.send", {}, 60_000)).rejects.toBeInstanceOf(ConnectionLostError);
  });

  it("reconnects and announces it", async () => {
    let connections = 0;
    const url = await startServer((ws) => {
      connections += 1;
      if (connections === 1) setTimeout(() => ws.terminate(), 20);
    });
    client = new GatewayClient(url, { apiKey: "", reconnectDelayMs: 20 });
    const reconnected = waitFor(client, "reconnected");
    await client.connect();
    await reconnected;
    expect(connections).toBe(2);
    expect(client.connected).toBe(true);
  });

  it("sends the API key on connect and again after a reconnect", async () => {
    const keys: string[] = [];
    let connections = 0;
    const url = await startServer((ws) => {
      connections += 1;
      const mine = connections;
      ws.on("message", (data) => {
        const req = JSON.parse(String(data));
        if (req.method === "auth") {
          keys.push(req.params.apiKey);
          ws.send(JSON.stringify({ id: req.id, result: { ok: true } }));
          if (mine === 1) setTimeout(() => ws.terminate(), 10);
        }
      });
    });
    client = new GatewayClient(url, { apiKey: "secret", reconnectDelayMs: 20 });
    const reconnected = waitFor(client, "reconnected");
    await client.connect();
    await reconnected;
    expect(keys).toEqual(["secret", "secret"]);
  });

  it("fails with GatewayAuthError and stops retrying when the key is rejected", async () => {
    let connections = 0;
    const url = await startServer((ws) => {
      connections += 1;
      ws.on("message", (data) => {
        const req = JSON.parse(String(data));
        ws.send(JSON.stringify({ id: req.id, error: { code: "UNAUTHORIZED", message: "Authentication required." } }));
      });
    });
    client = new GatewayClient(url, { apiKey: "wrong", reconnectDelayMs: 20 });
    await expect(client.connect()).rejects.toBeInstanceOf(GatewayAuthError);
    await new Promise((r) => setTimeout(r, 120));
    expect(connections).toBe(1);
  });

  it("carries on when an already-trusted socket doesn't know the auth method", async () => {
    const url = await startServer((ws) => {
      ws.on("message", (data) => {
        const req = JSON.parse(String(data));
        ws.send(JSON.stringify({ id: req.id, error: { code: "METHOD_NOT_FOUND", message: "Unknown method: auth" } }));
      });
    });
    client = new GatewayClient(url, { apiKey: "secret" });
    await client.connect();
    expect(client.connected).toBe(true);
  });
});
