import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import {
  HubError,
  HubPublisher,
  buildRegistration,
  checkHubUrl,
  friendlyHostName,
  hubQrPayload,
  hubWsUrl,
  isPublishable,
  isTailscaleIPv4,
  localGatewayRequiresKey,
  newDesktopId,
  newGatewayKey,
  newHubKey,
  pickAddresses,
  savedKeyWouldMove,
  testHubConnection,
  type PhoneLinkSettings,
} from "./phoneLinkCore.js";

const ready: PhoneLinkSettings = {
  hubUrl: "https://gateway.example.com",
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

  it("skips addresses a phone can't reach when picking the LAN one", () => {
    const iface = (address: string) => [{ address, family: "IPv4", internal: false }];
    // An idle Tailscale adapter listed first, as on Windows: link-local, neither LAN nor Tailscale.
    expect(
      pickAddresses({
        Tailscale: iface("169.254.83.107"),
        "Wi-Fi": iface("192.168.1.5"),
        "vEthernet (WSL (Hyper-V firewall))": iface("172.22.48.1"),
      }),
    ).toEqual({ lan: "192.168.1.5" });
    expect(pickAddresses({ "vEthernet (WSL)": iface("172.22.48.1"), Ethernet: iface("10.0.0.5") })).toEqual({ lan: "10.0.0.5" });
    // A public address still beats a virtual adapter, which remains the last resort.
    expect(pickAddresses({ docker0: iface("172.17.0.1"), eth0: iface("203.0.113.9") })).toEqual({ lan: "203.0.113.9" });
    expect(pickAddresses({ docker0: iface("172.17.0.1") })).toEqual({ lan: "172.17.0.1" });
    expect(pickAddresses({ Ethernet: iface("169.254.1.2") })).toEqual({});
  });

  it("turns the hub URL into a WebSocket URL", () => {
    expect(hubWsUrl("https://x.example.com/")).toBe("wss://x.example.com");
    expect(hubWsUrl("http://192.168.1.5:8787")).toBe("ws://192.168.1.5:8787");
    expect(hubWsUrl("wss://x.app")).toBe("wss://x.app");
    expect(hubWsUrl("x.example.com")).toBe("wss://x.example.com");
  });

  it("encodes the QR payload the app understands", () => {
    expect(hubQrPayload("https://x.app", "a b&c")).toBe("yggdrasil://hub?url=https%3A%2F%2Fx.app&key=a%20b%26c");
    expect(hubQrPayload(" gateway.example.com ", "k")).toBe("yggdrasil://hub?url=https%3A%2F%2Fgateway.example.com&key=k");
  });

  it("generates link server keys that survive a shell or YAML file", () => {
    expect(newHubKey()).toMatch(/^[0-9a-f]{64}$/);
    expect(newHubKey()).not.toBe(newHubKey());
  });

  describe("checkHubUrl", () => {
    it("accepts encrypted URLs anywhere", () => {
      for (const url of ["https://gateway.example.com", "wss://gateway.example.com", "gateway.example.com", "https://192.168.1.5"]) {
        expect(checkHubUrl(url)).toBe("ok");
      }
    });

    it("allows unencrypted only on local networks and tailnets", () => {
      for (const url of [
        "http://localhost:8787",
        "ws://127.0.0.1:8787",
        "http://[::1]:8787",
        "http://192.168.1.5:8787",
        "ws://10.0.0.2:8787",
        "http://172.20.0.1:8787",
        "ws://100.88.1.2:8787",
        "ws://box.example.ts.net:8787",
        "http://nas:8787",
        "http://nas.local:8787",
      ]) {
        expect(checkHubUrl(url), url).toBe("insecure-local");
      }
    });

    it("blocks unencrypted on anything public, including hosts dressed up as private addresses", () => {
      for (const url of [
        "http://gateway.example.com",
        "ws://gateway.example.com",
        "http://203.0.113.9:8787",
        "http://172.32.0.1",
        "http://192.168.evil.com",
        "http://10.0.0.evil.com",
        "http://100.64.evil.com",
        "http://127.0.0.1.evil.com",
        "http://localhost.evil.com",
        "http://fd00.evil.com",
        "http://ts.net.evil.com",
      ]) {
        expect(checkHubUrl(url), url).toBe("insecure-public");
      }
    });

    it("reports empty and malformed URLs", () => {
      expect(checkHubUrl("  ")).toBe("empty");
      expect(checkHubUrl("ftp://x.example.com")).toBe("invalid");
      expect(checkHubUrl("https://")).toBe("invalid");
      expect(checkHubUrl("not a url")).toBe("invalid");
    });
  });

  it("asks for the key again when the URL changes", () => {
    const saved = { hubUrl: "https://a.example.com", hubKey: "k" };
    expect(savedKeyWouldMove(saved, { hubUrl: "https://b.example.com", hubKey: "" })).toBe(true);
    expect(savedKeyWouldMove(saved, { hubUrl: "https://b.example.com" })).toBe(true);
    expect(savedKeyWouldMove(saved, { hubUrl: "https://b.example.com", hubKey: "new" })).toBe(false);
    expect(savedKeyWouldMove(saved, { hubUrl: " https://a.example.com ", hubKey: "" })).toBe(false);
    expect(savedKeyWouldMove(saved, { hubUrl: "", hubKey: "" })).toBe(false);
    expect(savedKeyWouldMove(saved, { publish: true } as { hubUrl?: string })).toBe(false);
    expect(savedKeyWouldMove({ hubUrl: "https://a.example.com" }, { hubUrl: "https://b.example.com", hubKey: "" })).toBe(false);
  });

  it("stops publishing to a saved URL that is now blocked", () => {
    expect(isPublishable(ready)).toBe(true);
    expect(isPublishable({ ...ready, hubUrl: "http://192.168.1.5:8787" })).toBe(true);
    expect(isPublishable({ ...ready, hubUrl: "http://gateway.example.com" })).toBe(false);
    expect(isPublishable({ ...ready, hubUrl: "ws://203.0.113.9:8787" })).toBe(false);
  });

  describe("testHubConnection", () => {
    const yggdrasil = (async () => new Response(JSON.stringify({ ok: true, service: "yggdrasil-gateway" }))) as typeof fetch;
    const url = "https://gateway.example.com";

    it("refuses before any network call when the URL or key can't be used", async () => {
      const fetchImpl = (async () => {
        throw new Error("no network expected");
      }) as typeof fetch;
      expect(await testHubConnection("nope nope", "k", { fetchImpl })).toMatchObject({ code: "invalid-url" });
      expect(await testHubConnection("http://gateway.example.com", "k", { fetchImpl })).toMatchObject({ code: "insecure" });
      expect(await testHubConnection(url, " ", { fetchImpl })).toMatchObject({ code: "missing-key" });
    });

    it("never sends the key to something that isn't a Yggdrasil gateway", async () => {
      const call = (async () => {
        throw new Error("the key must not be sent");
      }) as never;
      const html = (async () => new Response("<html>hi</html>")) as typeof fetch;
      const other = (async () => new Response(JSON.stringify({ service: "other" }))) as typeof fetch;
      expect(await testHubConnection(url, "k", { fetchImpl: html, call })).toMatchObject({ code: "not-yggdrasil" });
      expect(await testHubConnection(url, "k", { fetchImpl: other, call })).toMatchObject({ code: "not-yggdrasil" });
    });

    it("reports why the server can't be reached", async () => {
      const fetchImpl = (async () => {
        throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
      }) as typeof fetch;
      expect(await testHubConnection(url, "k", { fetchImpl })).toEqual({ ok: false, code: "unreachable", detail: "ENOTFOUND" });
    });

    it("tells a wrong key from a server with no key and an old server", async () => {
      const failing = (e: Error) =>
        (async () => {
          throw e;
        }) as never;
      const run = (e: Error) => testHubConnection(url, "k", { fetchImpl: yggdrasil, call: failing(e) });
      expect(await run(new HubError("no", "auth", "UNAUTHORIZED"))).toMatchObject({ code: "bad-key" });
      expect(await run(new HubError("no", "auth", "METHOD_NOT_FOUND"))).toMatchObject({ code: "server-open" });
      expect(await run(new HubError("no", "call", "METHOD_NOT_FOUND"))).toMatchObject({ code: "no-directory" });
      expect(await run(new Error("socket hang up"))).toMatchObject({ code: "unreachable" });
    });

    it("succeeds and flags an unencrypted local server", async () => {
      const call = (async () => ({ desktops: [{}, {}] })) as never;
      expect(await testHubConnection(url, "k", { fetchImpl: yggdrasil, call })).toEqual({ ok: true, desktops: 2, insecure: false });
      expect(await testHubConnection("http://192.168.1.5:8787", "k", { fetchImpl: yggdrasil, call })).toEqual({ ok: true, desktops: 2, insecure: true });
    });
  });

  it("cleans the host name and builds the registration", () => {
    expect(friendlyHostName("Alexs-MacBook-Pro.local")).toBe("Alexs-MacBook-Pro");
    expect(buildRegistration(ready, "Mac", [{ id: "p1", name: "my-project", port: 5000 }], { lan: "192.168.1.20" })).toEqual({
      desktopId: "desk-abc123",
      name: "Mac",
      projects: [{ id: "p1", name: "my-project", port: 5000 }],
      endpoints: { lan: "192.168.1.20" },
      gatewayKey: "ygd_key",
    });
  });
});

describe("HubPublisher", () => {
  const base = {
    getProjects: async () => [{ id: "p1", name: "my-project", port: 5000 }],
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
