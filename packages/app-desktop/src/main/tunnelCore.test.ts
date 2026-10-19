import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { TunnelClient } from "./tunnelCore.js";

let hubServer: Server;
let hubWss: WebSocketServer;
let localWss: WebSocketServer;
let localPort: number;
let hubUrl: string;
let hostSocket: WebSocket | null;
const hostFrames: Array<Record<string, unknown>> = [];
const localHeaders: Array<string | undefined> = [];
let client: TunnelClient | null;

const waitFor = async (pred: () => boolean, ms = 2000) => {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
};

beforeEach(async () => {
  hostFrames.length = 0;
  localHeaders.length = 0;
  hostSocket = null;
  // Fake hub: accepts /tunnel-host/<id> with key "hub-key".
  hubServer = createServer();
  hubWss = new WebSocketServer({ server: hubServer });
  hubWss.on("connection", (ws, req) => {
    if (!req.url?.startsWith("/tunnel-host/desk-unit-01")) return ws.close(4000);
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      hostFrames.push(msg);
      if (msg.t === "auth") {
        if (msg.key !== "hub-key") return ws.close(4401, "unauthorized");
        hostSocket = ws;
        ws.send(JSON.stringify({ t: "ready" }));
      }
    });
  });
  await new Promise<void>((r) => hubServer.listen(0, "127.0.0.1", r));
  hubUrl = `http://127.0.0.1:${(hubServer.address() as AddressInfo).port}`;
  // Fake local project gateway: echoes, and records the tunnel header.
  localWss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((r) => localWss.once("listening", () => r()));
  localPort = (localWss.address() as AddressInfo).port;
  localWss.on("connection", (ws, req) => {
    localHeaders.push(req.headers["x-yggdrasil-tunnel"] as string | undefined);
    ws.on("message", (raw) => ws.send(`echo:${raw.toString()}`));
  });
});

afterEach(async () => {
  client?.stop();
  client = null;
  await new Promise<void>((r) => hubWss.close(() => hubServer.close(() => r())));
  await new Promise<void>((r) => localWss.close(() => r()));
});

const settings = (key = "hub-key") => async () => ({
  hubUrl,
  hubKey: key,
  publish: true,
  desktopId: "desk-unit-01",
  gatewayKey: "ygd_unit",
});

describe("TunnelClient", () => {
  it("attaches with the hub key and becomes connected", async () => {
    client = new TunnelClient({ getSettings: settings(), getProjectPort: async () => localPort });
    await client.start();
    await waitFor(() => client!.state === "connected");
    expect(hostFrames[0]).toEqual({ t: "auth", key: "hub-key" });
  });

  it("bridges a channel to the local gateway, marking it as tunnel traffic", async () => {
    client = new TunnelClient({ getSettings: settings(), getProjectPort: async (id) => (id === "p1" ? localPort : undefined) });
    await client.start();
    await waitFor(() => client!.state === "connected");

    hostSocket!.send(JSON.stringify({ t: "open", ch: "c1", projectId: "p1" }));
    hostSocket!.send(JSON.stringify({ t: "data", ch: "c1", d: "hola" })); // may arrive before the local socket opens
    await waitFor(() => hostFrames.some((f) => f.t === "data"));
    expect(hostFrames.find((f) => f.t === "data")).toEqual({ t: "data", ch: "c1", d: "echo:hola" });
    expect(localHeaders).toEqual(["1"]);
  });

  it("refuses a channel for a project that is not open", async () => {
    client = new TunnelClient({ getSettings: settings(), getProjectPort: async () => undefined });
    await client.start();
    await waitFor(() => client!.state === "connected");
    hostSocket!.send(JSON.stringify({ t: "open", ch: "c9", projectId: "nope" }));
    await waitFor(() => hostFrames.some((f) => f.t === "close"));
    expect(hostFrames.find((f) => f.t === "close")).toMatchObject({ t: "close", ch: "c9" });
  });

  it("reports a rejected hub key and stays off while publishing is disabled", async () => {
    client = new TunnelClient({ getSettings: settings("wrong"), getProjectPort: async () => localPort, retryDelaysMs: [60_000] });
    await client.start();
    await waitFor(() => client!.state === "error");
    expect(client.lastError).toBe("Railway rechazó la clave");

    const off = new TunnelClient({
      getSettings: async () => ({ hubUrl, hubKey: "hub-key", publish: false, desktopId: "desk-unit-01", gatewayKey: "k" }),
      getProjectPort: async () => localPort,
    });
    await off.start();
    expect(off.state).toBe("disabled");
    off.stop();
  });

  it("reconnects after the hub drops it", async () => {
    client = new TunnelClient({ getSettings: settings(), getProjectPort: async () => localPort, retryDelaysMs: [20] });
    await client.start();
    await waitFor(() => client!.state === "connected");
    const first = hostSocket;
    first!.close(1001, "restart");
    await waitFor(() => hostSocket !== first && client!.state === "connected");
    expect(hostFrames.filter((f) => f.t === "auth")).toHaveLength(2);
  });
});
