import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import {
  HubPublisher,
  buildRegistration,
  friendlyHostName,
  hubQrPayload,
  hubWsUrl,
  isTailscaleIPv4,
  localGatewayRequiresKey,
  newDesktopId,
  newGatewayKey,
  pickAddresses,
  type PhoneLinkSettings,
} from "./phoneLinkCore.js";

const ready: PhoneLinkSettings = {
  hubUrl: "https://hub.example.com",
  hubKey: "hub-secret",
  publish: true,
  desktopId: "desk-abc123",
  gatewayKey: "ygd_key",
};

describe("phone link helpers", () => {
  it("generates ids and keys the hub accepts", () => {
    expect(newDesktopId()).toMatch(/^desk-[A-Za-z0-9_-]{6,58}$/);
    expect(newGatewayKey()).toMatch(/^ygd_[A-Za-z0-9_-]{20,}$/);
    expect(newGatewayKey()).not.toBe(newGatewayKey());
  });

  it("tells Tailscale addresses from LAN ones", () => {
    expect(isTailscaleIPv4("100.64.0.7")).toBe(true);
    expect(isTailscaleIPv4("100.127.255.1")).toBe(true);
    expect(isTailscaleIPv4("100.128.0.1")).toBe(false);
    expect(isTailscaleIPv4("192.168.1.20")).toBe(false);
    expect(
      pickAddresses({
        lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
        en0: [
          { address: "fe80::1", family: "IPv6", internal: false },
          { address: "192.168.1.20", family: "IPv4", internal: false },
        ],
        utun4: [{ address: "100.88.1.2", family: 4, internal: false }],
      }),
    ).toEqual({ lan: "192.168.1.20", tailscale: "100.88.1.2" });
    expect(pickAddresses({})).toEqual({});
  });

  it("turns the hub URL into a WebSocket URL", () => {
    expect(hubWsUrl("https://x.up.railway.app/")).toBe("wss://x.up.railway.app");
    expect(hubWsUrl("http://192.168.1.5:8787")).toBe("ws://192.168.1.5:8787");
    expect(hubWsUrl("wss://x.app")).toBe("wss://x.app");
    expect(hubWsUrl("x.up.railway.app")).toBe("wss://x.up.railway.app");
  });

  it("encodes the QR payload the app understands", () => {
    expect(hubQrPayload("https://x.app", "a b&c")).toBe("yggdrasil://hub?url=https%3A%2F%2Fx.app&key=a%20b%26c");
  });

  it("cleans the host name and builds the registration", () => {
    expect(friendlyHostName("Alexs-MacBook-Pro.local")).toBe("Alexs-MacBook-Pro");
    expect(buildRegistration(ready, "Mac", [{ id: "p1", name: "harness_pp", port: 5000 }], { lan: "192.168.1.20" })).toEqual({
      desktopId: "desk-abc123",
      name: "Mac",
      projects: [{ id: "p1", name: "harness_pp", port: 5000 }],
      endpoints: { lan: "192.168.1.20" },
      gatewayKey: "ygd_key",
    });
  });
});

describe("HubPublisher", () => {
  const base = {
    getProjects: async () => [{ id: "p1", name: "harness_pp", port: 5000 }],
    getHostName: () => "Mac",
    getAddresses: () => ({ lan: "192.168.1.20" }),
    now: () => 1000,
  };

  it("registers when publishing is enabled and records success", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const p = new HubPublisher({
      ...base,
      getSettings: async () => ready,
      call: async (_url, _key, method, params) => (calls.push([method, params]), { ok: true }),
    });
    expect(await p.publishNow()).toEqual({ state: "ok", lastOkAt: 1000, lastAttemptAt: 1000 });
    expect(calls[0]![0]).toBe("desktops.register");
    expect(calls[0]![1]).toMatchObject({ desktopId: "desk-abc123", gatewayKey: "ygd_key" });
  });

  it("does nothing while disabled or incomplete", async () => {
    let called = false;
    const p = new HubPublisher({
      ...base,
      getSettings: async () => ({ ...ready, publish: false }),
      call: async () => ((called = true), {}),
    });
    expect((await p.publishNow()).state).toBe("disabled");
    expect(called).toBe(false);
  });

  it("keeps the last success time when an attempt fails", async () => {
    let fail = false;
    const p = new HubPublisher({
      ...base,
      getSettings: async () => ready,
      call: async () => {
        if (fail) throw new Error("hub rejected the key: unauthorized");
        return {};
      },
    });
    await p.publishNow();
    fail = true;
    expect(await p.publishNow()).toMatchObject({ state: "error", lastOkAt: 1000, lastError: "hub rejected the key: unauthorized" });
  });

  it("shares one attempt between concurrent callers", async () => {
    let n = 0;
    const p = new HubPublisher({
      ...base,
      getSettings: async () => ready,
      call: async () => {
        n++;
        await new Promise((r) => setTimeout(r, 10));
        return {};
      },
    });
    await Promise.all([p.publishNow(), p.publishNow(), p.publishNow()]);
    expect(n).toBe(1);
  });

  it("goOffline tells the hub and never throws", async () => {
    const methods: string[] = [];
    const p = new HubPublisher({
      ...base,
      getSettings: async () => ready,
      call: async (_u, _k, method) => {
        methods.push(method);
        throw new Error("network down");
      },
    });
    await expect(p.goOffline()).resolves.toBeUndefined();
    expect(methods).toEqual(["desktops.offline"]);
  });
});

describe("localGatewayRequiresKey", () => {
  const servers: WebSocketServer[] = [];
  afterEach(() => {
    for (const s of servers.splice(0)) s.close();
  });

  const fakeGateway = (reply: Record<string, unknown>) =>
    new Promise<number>((resolve) => {
      const wss: WebSocketServer = new WebSocketServer({ host: "127.0.0.1", port: 0 }, (): void =>
        resolve((wss.address() as { port: number }).port),
      );
      servers.push(wss);
      wss.on("connection", (ws: WebSocket) => ws.on("message", (raw: WebSocket.RawData) => ws.send(JSON.stringify({ id: JSON.parse(String(raw)).id, ...reply }))));
    });

  it("reads keyConfigured from health", async () => {
    expect(await localGatewayRequiresKey(await fakeGateway({ result: { ok: true, keyConfigured: true } }))).toBe(true);
    expect(await localGatewayRequiresKey(await fakeGateway({ result: { ok: true, keyConfigured: false } }))).toBe(false);
  });

  it("ignores authRequired — a keyed gateway's own trusted-loopback override forces that to false", async () => {
    // Reproduces the bug: server.ts's health override always reports
    // authRequired:false to a loopback-trusted caller, which this probe
    // itself is — keyConfigured is the field that survives that override.
    expect(
      await localGatewayRequiresKey(await fakeGateway({ result: { ok: true, authRequired: false, keyConfigured: true } })),
    ).toBe(true);
  });

  it("treats an UNAUTHORIZED health as keyed", async () => {
    expect(await localGatewayRequiresKey(await fakeGateway({ error: { code: "UNAUTHORIZED" } }))).toBe(true);
  });

  it("is null when nothing answers", async () => {
    const port = await fakeGateway({ result: {} });
    servers.splice(0).forEach((s) => s.close());
    expect(await localGatewayRequiresKey(port, { timeoutMs: 500 })).toBeNull();
  });
});
