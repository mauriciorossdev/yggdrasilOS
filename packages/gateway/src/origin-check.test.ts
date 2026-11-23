import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import type { Mock } from "vitest";
import { WebSocket } from "ws";

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: vi.fn() };
});

import { homedir } from "node:os";
import { DEFAULT_CONFIG, mergeConfig, type YggdrasilConfig } from "@yggdrasil/config";
import { startGatewayServer, type GatewayServer } from "./server.js";
import { isForeignOrigin } from "./originCheck.js";

/**
 * A website open in the user's browser can open ws://127.0.0.1:<port>. It must not get this
 * machine's implicit trust (originCheck.ts), and no unauthenticated socket gets events.
 */

type Reply = { id?: string; result?: Record<string, unknown>; error?: { code: string; message: string } };

function request(ws: WebSocket, id: string, method: string, params: Record<string, unknown> = {}): Promise<Reply> {
  return new Promise((resolve) => {
    const onMessage = (raw: Buffer) => {
      const msg = JSON.parse(raw.toString()) as Reply;
      if (msg.id !== id) return;
      ws.off("message", onMessage);
      resolve(msg);
    };
    ws.on("message", onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

describe("isForeignOrigin", () => {
  it("trusts no Origin, loopback hosts and file://; refuses other sites and null", () => {
    const env = {};
    expect(isForeignOrigin(undefined, env)).toBe(false);
    expect(isForeignOrigin("http://localhost:5173", env)).toBe(false);
    expect(isForeignOrigin("http://127.0.0.1:18789", env)).toBe(false);
    expect(isForeignOrigin("http://[::1]:3000", env)).toBe(false);
    expect(isForeignOrigin("file://", env)).toBe(false);
    expect(isForeignOrigin("https://evil.example", env)).toBe(true);
    expect(isForeignOrigin("http://localhost.evil.example", env)).toBe(true);
    expect(isForeignOrigin("http://192.168.1.20:18789", env)).toBe(true);
    expect(isForeignOrigin("null", env)).toBe(true);
    expect(isForeignOrigin("chrome-extension://abc", env)).toBe(true);
  });

  it("YGGDRASIL_ALLOWED_ORIGINS adds exact origins, or * for any", () => {
    const env = { YGGDRASIL_ALLOWED_ORIGINS: "https://my.host:8443/, capacitor://localhost" };
    expect(isForeignOrigin("https://my.host:8443", env)).toBe(false);
    expect(isForeignOrigin("capacitor://localhost", env)).toBe(false);
    expect(isForeignOrigin("https://other.host", env)).toBe(true);
    expect(isForeignOrigin("https://anything", { YGGDRASIL_ALLOWED_ORIGINS: "*" })).toBe(false);
  });
});

describe("WebSocket from a foreign origin", () => {
  let gateway: GatewayServer;
  let dir: string;
  let url: string;
  const sockets: WebSocket[] = [];

  async function start(extra: Partial<YggdrasilConfig> = {}) {
    dir = await mkdtemp(join(tmpdir(), "ygg-origin-"));
    const config = mergeConfig(DEFAULT_CONFIG, { sessions: { dir }, gateway: { port: 0 }, ...extra });
    gateway = await startGatewayServer({ config, workspaceRoot: dir, startChannels: false });
    url = `ws://127.0.0.1:${(gateway.httpServer.address() as AddressInfo).port}/`;
  }

  function connect(origin?: string, query = ""): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url + query, origin ? { origin } : undefined);
      sockets.push(ws);
      ws.once("open", () => resolve(ws));
      ws.once("error", reject);
    });
  }

  /** Events this socket receives while `chat.final` is emitted once. */
  async function eventsDuringEmit(ws: WebSocket): Promise<string[]> {
    const seen: string[] = [];
    ws.on("message", (raw: Buffer) => {
      const msg = JSON.parse(raw.toString()) as { type?: string; event?: string };
      if (msg.type === "event" && msg.event) seen.push(msg.event);
    });
    await gateway.context.events.emit("chat.final", { sessionKey: "web:default:x", text: "secret" });
    await new Promise((r) => setTimeout(r, 50));
    return seen;
  }

  beforeEach(async () => {
    (homedir as unknown as Mock).mockReturnValue(await mkdtemp(join(tmpdir(), "ygg-home-origin-")));
    delete process.env.YGGDRASIL_ALLOWED_ORIGINS;
    delete process.env.YGGDRASIL_TRUST_LOOPBACK;
  });

  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.terminate();
    await gateway.close();
    await rm(dir, { recursive: true, force: true });
    delete process.env.YGGDRASIL_ALLOWED_ORIGINS;
    delete process.env.YGGDRASIL_TRUST_LOOPBACK;
  });

  it("no key configured: no Origin and loopback origins connect; another site is refused and gets no events", async () => {
    await start();
    const node = await connect();
    expect((await request(node, "1", "config.get")).error).toBeUndefined();
    const devRenderer = await connect("http://localhost:5173");
    expect((await request(devRenderer, "1", "config.get")).error).toBeUndefined();

    const evil = await connect("https://evil.example");
    const refused = await request(evil, "1", "config.get");
    expect(refused.error?.code).toBe("UNAUTHORIZED");
    expect(refused.error?.message).toContain("other sites");
    expect((await request(evil, "2", "auth", { apiKey: "" })).error?.code).toBe("UNAUTHORIZED");
    expect((await request(evil, "3", "terminals.write", { id: "x", data: "rm -rf ~" })).error?.code).toBe("UNAUTHORIZED");
    expect(await eventsDuringEmit(evil)).toEqual([]);
    expect(await eventsDuringEmit(node)).toContain("chat.final");
  });

  it("YGGDRASIL_TRUST_LOOPBACK does not extend to a foreign page", async () => {
    process.env.YGGDRASIL_TRUST_LOOPBACK = "1";
    await start({ auth: { gateway: { apiKey: "k1" } } });
    expect((await request(await connect(), "1", "config.get")).error).toBeUndefined();
    expect((await request(await connect("https://evil.example"), "1", "config.get")).error?.code).toBe("UNAUTHORIZED");
  });

  it("a foreign page with the real key gets in (auth message or ?apiKey=)", async () => {
    await start({ auth: { gateway: { apiKey: "k1" } } });
    const ws = await connect("https://console.example");
    expect((await request(ws, "1", "auth", { apiKey: "nope" })).error?.code).toBe("UNAUTHORIZED");
    expect((await request(ws, "2", "auth", { apiKey: "k1" })).result).toEqual({ ok: true });
    expect((await request(ws, "3", "config.get")).error).toBeUndefined();
    expect(await eventsDuringEmit(ws)).toContain("chat.final");

    const viaQuery = await connect("https://console.example", "?apiKey=k1");
    expect((await request(viaQuery, "1", "config.get")).error).toBeUndefined();
  });

  it("an unauthenticated socket gets no events until it authenticates", async () => {
    await start({ auth: { gateway: { apiKey: "k1" } } });
    const ws = await connect();
    expect(await eventsDuringEmit(ws)).toEqual([]);
  });

  it("YGGDRASIL_ALLOWED_ORIGINS lets a listed site in like a local page", async () => {
    process.env.YGGDRASIL_ALLOWED_ORIGINS = "https://console.example";
    await start();
    expect((await request(await connect("https://console.example"), "1", "config.get")).error).toBeUndefined();
  });
});
