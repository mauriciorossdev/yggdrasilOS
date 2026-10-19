import { describe, it, expect, afterEach } from "vitest";
import type { ChannelGatewayStartContext, NormalizedInboundMessage } from "@yggdrasil/sdk";
import { httpChannel } from "./channel.js";

let port = 19100;
function nextPort(): number {
  return port++;
}

function startContext(overrides: {
  accountId: string;
  port: number;
  onInbound: (msg: NormalizedInboundMessage) => Promise<void>;
  globalConfig?: unknown;
  token?: string;
}): { ctx: ChannelGatewayStartContext; controller: AbortController } {
  const controller = new AbortController();
  const ctx: ChannelGatewayStartContext = {
    accountId: overrides.accountId,
    config: { port: overrides.port, host: "127.0.0.1", token: overrides.token },
    abortSignal: controller.signal,
    onInbound: overrides.onInbound,
    globalConfig: overrides.globalConfig,
  };
  return { ctx, controller };
}

describe("http channel", () => {
  const controllers: AbortController[] = [];

  afterEach(async () => {
    for (const c of controllers.splice(0)) c.abort();
    await new Promise((r) => setTimeout(r, 10));
  });

  it("accepts an inbound POST and returns the final reply as JSON", async () => {
    const p = nextPort();
    const accountId = `acc-${p}`;
    const { ctx, controller } = startContext({
      accountId,
      port: p,
      onInbound: async (msg) => {
        await httpChannel.outbound!.sendFinal!(
          { channelId: "http", accountId, sessionKey: msg.sessionKey },
          { text: `echo: ${msg.body}` },
        );
      },
    });
    controllers.push(controller);
    await httpChannel.gateway!.startAccount(ctx);

    const res = await fetch(`http://127.0.0.1:${p}/inbound`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hello", senderId: "tester" }),
    });
    const body = (await res.json()) as { reply: string; sessionKey: string };

    expect(res.status).toBe(200);
    expect(body.reply).toBe("echo: hello");
  });

  it("returns 404 for unknown paths or non-POST methods", async () => {
    const p = nextPort();
    const accountId = `acc-${p}`;
    const { ctx, controller } = startContext({
      accountId,
      port: p,
      onInbound: async () => {},
    });
    controllers.push(controller);
    await httpChannel.gateway!.startAccount(ctx);

    const res = await fetch(`http://127.0.0.1:${p}/inbound`, { method: "GET" });
    expect(res.status).toBe(404);
  });

  it("rejects with 401 when an api key is required and missing/invalid", async () => {
    const p = nextPort();
    const accountId = `acc-${p}`;
    const { ctx, controller } = startContext({
      accountId,
      port: p,
      onInbound: async () => {},
      globalConfig: {
        auth: { http: { apiKey: "secret-key" } },
      },
    });
    controllers.push(controller);
    await httpChannel.gateway!.startAccount(ctx);

    const noAuth = await fetch(`http://127.0.0.1:${p}/inbound`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hi" }),
    });
    expect(noAuth.status).toBe(401);

    const wrongAuth = await fetch(`http://127.0.0.1:${p}/inbound`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer nope" },
      body: JSON.stringify({ message: "hi" }),
    });
    expect(wrongAuth.status).toBe(401);
  });

  it("stopAccount closes the server so subsequent requests fail", async () => {
    const p = nextPort();
    const accountId = `acc-${p}`;
    const { ctx, controller } = startContext({
      accountId,
      port: p,
      onInbound: async () => {},
    });
    controllers.push(controller);
    await httpChannel.gateway!.startAccount(ctx);
    await httpChannel.gateway!.stopAccount({ accountId, config: ctx.config });

    await expect(fetch(`http://127.0.0.1:${p}/inbound`, { method: "POST" })).rejects.toThrow();
  });
});
