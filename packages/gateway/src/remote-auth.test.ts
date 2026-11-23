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

/**
 * notes/features/web-console-upgrade.md, "Seguridad": another device always needs a key.
 * A loopback socket marked as tunnel traffic (x-yggdrasil-tunnel: 1, what the desktop sets
 * for phone-link relays) is treated as remote, which lets this test act as another device.
 */

type Reply = { id?: string; result?: Record<string, unknown>; error?: { code: string; message: string } };

function open(url: string, remote: boolean): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, remote ? { headers: { "x-yggdrasil-tunnel": "1" } } : undefined);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

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

describe("remote connections need a key", () => {
  let gateway: GatewayServer;
  let dir: string;
  let url: string;
  const sockets: WebSocket[] = [];

  async function start(extra: Partial<YggdrasilConfig> = {}) {
    dir = await mkdtemp(join(tmpdir(), "ygg-remote-auth-"));
    const config = mergeConfig(DEFAULT_CONFIG, { sessions: { dir }, gateway: { port: 0 }, ...extra });
    gateway = await startGatewayServer({ config, workspaceRoot: dir, startChannels: false });
    url = `ws://127.0.0.1:${(gateway.httpServer.address() as AddressInfo).port}/`;
  }

  async function connect(remote: boolean, query = "") {
    const ws = await open(url + query, remote);
    sockets.push(ws);
    return ws;
  }

  beforeEach(async () => {
    (homedir as unknown as Mock).mockReturnValue(await mkdtemp(join(tmpdir(), "ygg-home-remote-auth-")));
    delete process.env.YGGDRASIL_ALLOW_UNAUTHENTICATED_REMOTE;
  });

  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.terminate();
    await gateway.close();
    await rm(dir, { recursive: true, force: true });
    delete process.env.YGGDRASIL_ALLOW_UNAUTHENTICATED_REMOTE;
  });

  it("without a configured key: this machine connects freely, another device is refused with a way out", async () => {
    await start();
    const local = await connect(false);
    expect((await request(local, "1", "config.get")).error).toBeUndefined();

    const remote = await connect(true);
    const refused = await request(remote, "1", "config.get");
    expect(refused.error?.code).toBe("UNAUTHORIZED");
    expect(refused.error?.message).toContain("Paired devices");
    // Any key is wrong when there is none to match.
    expect((await request(remote, "2", "auth", { apiKey: "" })).error?.code).toBe("UNAUTHORIZED");
    expect((await request(remote, "3", "config.patch", { defaultAgent: "plan" })).error?.code).toBe("UNAUTHORIZED");
  });

  it("health answers before auth and tells the other device a key is needed", async () => {
    await start();
    const health = await request(await connect(true), "1", "health");
    expect(health.result?.ok).toBe(true);
    expect(health.result?.authRequired).toBe(true);
  });

  it("with a key: another device gets in with it (auth message or ?apiKey=), not without", async () => {
    await start({ auth: { gateway: { apiKey: "k1" } } });
    const remote = await connect(true);
    expect((await request(remote, "1", "config.get")).error?.code).toBe("UNAUTHORIZED");
    expect((await request(remote, "2", "auth", { apiKey: "nope" })).error?.code).toBe("UNAUTHORIZED");
    expect((await request(remote, "3", "auth", { apiKey: "k1" })).result).toEqual({ ok: true });
    expect((await request(remote, "4", "config.get")).error).toBeUndefined();

    const viaQuery = await connect(true, "?apiKey=k1");
    expect((await request(viaQuery, "1", "config.get")).error).toBeUndefined();
  });

  it("YGGDRASIL_ALLOW_UNAUTHENTICATED_REMOTE=1 restores the old open behavior on purpose", async () => {
    process.env.YGGDRASIL_ALLOW_UNAUTHENTICATED_REMOTE = "1";
    await start();
    expect((await request(await connect(true), "1", "config.get")).error).toBeUndefined();
  });
});
