import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { MAX_CHANNELS_PER_DESKTOP, TunnelHub } from "./tunnel.js";

const HUB_KEY = "hub-key";
const DESK = "desk-test-01";
const DESK_KEY = "ygd_desk";

let server: Server;
let hub: TunnelHub;
let base: string;
const sockets: WebSocket[] = [];

function open(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    sockets.push(ws);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}
const nextMessage = (ws: WebSocket) => new Promise<string>((r) => ws.once("message", (d) => r(d.toString())));
const closed = (ws: WebSocket) => new Promise<number>((r) => ws.once("close", (code) => r(code)));

/** A fake desktop: attaches to the hub and bridges channels to an in-process "local gateway". */
async function attachDesktop(key = HUB_KEY) {
  const host = await open(`${base}/tunnel-host/${DESK}`);
  const opened: Array<{ ch: string; projectId: string }> = [];
  const received: Array<{ ch: string; d: string }> = [];
  host.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.t === "open") opened.push({ ch: msg.ch, projectId: msg.projectId });
    if (msg.t === "data") {
      received.push({ ch: msg.ch, d: msg.d });
      // Local gateway stand-in: answer every request with an echo of its method.
      const req = JSON.parse(msg.d);
      host.send(JSON.stringify({ t: "data", ch: msg.ch, d: JSON.stringify({ id: req.id, result: { echo: req.method } }) }));
    }
  });
  host.send(JSON.stringify({ t: "auth", key }));
  const first = JSON.parse(await nextMessage(host));
  return { host, first, opened, received };
}

beforeEach(async () => {
  hub = new TunnelHub({
    validateHostKey: (k) => k === HUB_KEY,
    desktopKey: (id) => (id === DESK ? DESK_KEY : undefined),
  });
  server = createServer();
  const fallback = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    if (!hub.handleUpgrade(req, socket, head)) fallback.handleUpgrade(req, socket, head, (ws) => ws.close(4000, "not a tunnel"));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  hub.close();
  await new Promise<void>((r) => server.close(() => r()));
});

describe("TunnelHub", () => {
  it("attaches a desktop with the hub key and relays a phone channel both ways", async () => {
    const { first, opened, received } = await attachDesktop();
    expect(first).toEqual({ t: "ready" });
    expect(hub.isAttached(DESK)).toBe(true);

    const phone = await open(`${base}/tunnel/${DESK}/project-1`);
    phone.send(JSON.stringify({ id: "init-auth", method: "auth", params: { apiKey: DESK_KEY } }));
    expect(JSON.parse(await nextMessage(phone))).toEqual({ id: "init-auth", result: { echo: "auth" } });
    phone.send(JSON.stringify({ id: "1", method: "sessions.get", params: {} }));
    expect(JSON.parse(await nextMessage(phone))).toEqual({ id: "1", result: { echo: "sessions.get" } });

    expect(opened).toEqual([{ ch: opened[0]!.ch, projectId: "project-1" }]);
    expect(received.map((r) => JSON.parse(r.d).method)).toEqual(["auth", "sessions.get"]);
  });

  it("refuses a desktop with the wrong hub key", async () => {
    const host = await open(`${base}/tunnel-host/${DESK}`);
    const code = closed(host);
    host.send(JSON.stringify({ t: "auth", key: "nope" }));
    expect(JSON.parse(await nextMessage(host))).toEqual({ t: "error", reason: "unauthorized" });
    expect(await code).toBe(4401);
    expect(hub.isAttached(DESK)).toBe(false);
  });

  it("refuses a phone with the wrong desktop key and relays nothing", async () => {
    const { opened } = await attachDesktop();
    const phone = await open(`${base}/tunnel/${DESK}/project-1`);
    const code = closed(phone);
    phone.send(JSON.stringify({ id: "init-auth", method: "auth", params: { apiKey: "guess" } }));
    expect(JSON.parse(await nextMessage(phone)).error.code).toBe("UNAUTHORIZED");
    expect(await code).toBe(4401);
    expect(opened).toEqual([]);
  });

  it("tells the phone when the desktop has no tunnel", async () => {
    const phone = await open(`${base}/tunnel/${DESK}/project-1`);
    const code = closed(phone);
    phone.send(JSON.stringify({ id: "a", method: "auth", params: { apiKey: DESK_KEY } }));
    expect(JSON.parse(await nextMessage(phone)).error.code).toBe("UNAVAILABLE");
    expect(await code).toBe(4404);
  });

  it("closes phone channels when the desktop drops, and tells the desktop when a phone leaves", async () => {
    const { host } = await attachDesktop();
    const phone = await open(`${base}/tunnel/${DESK}/p`);
    phone.send(JSON.stringify({ id: "a", method: "auth", params: { apiKey: DESK_KEY } }));
    await nextMessage(phone);

    const hostSawClose = new Promise<string>((r) => host.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.t === "close") r(m.ch);
    }));
    phone.close();
    expect(typeof (await hostSawClose)).toBe("string");

    const phone2 = await open(`${base}/tunnel/${DESK}/p`);
    phone2.send(JSON.stringify({ id: "a", method: "auth", params: { apiKey: DESK_KEY } }));
    await nextMessage(phone2);
    const code = closed(phone2);
    host.close();
    expect(await code).toBe(4503);
    await new Promise((r) => setTimeout(r, 20));
    expect(hub.isAttached(DESK)).toBe(false);
  });

  it("caps the channels per desktop", async () => {
    await attachDesktop();
    const phones: WebSocket[] = [];
    for (let i = 0; i < MAX_CHANNELS_PER_DESKTOP; i++) {
      const p = await open(`${base}/tunnel/${DESK}/p`);
      p.send(JSON.stringify({ id: "a", method: "auth", params: { apiKey: DESK_KEY } }));
      await nextMessage(p);
      phones.push(p);
    }
    const extra = await open(`${base}/tunnel/${DESK}/p`);
    extra.send(JSON.stringify({ id: "a", method: "auth", params: { apiKey: DESK_KEY } }));
    expect(JSON.parse(await nextMessage(extra)).error.code).toBe("BUSY");
  });

  it("leaves non-tunnel upgrades alone", async () => {
    const ws = await open(`${base}/`);
    expect(await closed(ws)).toBe(4000);
  });
});
