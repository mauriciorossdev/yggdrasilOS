import { describe, it, expect, afterEach } from "vitest";
import { createTestPlatform, GatewayWsClient, postInbound } from "../helpers/index.js";

describe("iter2 sessions and http e2e", () => {
  let platform: Awaited<ReturnType<typeof createTestPlatform>>;

  afterEach(async () => {
    await platform?.close();
  });

  it("POST /inbound returns echo reply", async () => {
    platform = await createTestPlatform({
      withHttpChannel: true,
      startServer: true,
      startChannels: true,
      withEchoChannel: false,
      withLlmPlugins: false,
      configOverride: {
        agents: [{ id: "default", provider: "builtin", model: "echo" }],
      },
    });

    const response = await postInbound(`http://127.0.0.1:${platform.httpPort}`, {
      message: "hola http",
      sessionKey: "http:test:curl",
    });

    expect(response.status).toBe(200);
    const body = response.body as { reply: string; sessionKey: string };
    expect(body.reply).toBe("echo: hola http");
    expect(body.sessionKey).toBe("http:test:curl");
  });

  it("multi-turn HTTP same sessionKey persists history", async () => {
    platform = await createTestPlatform({
      withHttpChannel: true,
      startServer: true,
      startChannels: true,
      withEchoChannel: false,
      withLlmPlugins: false,
      configOverride: {
        agents: [{ id: "default", provider: "builtin", model: "echo" }],
      },
    });

    const sessionKey = "http:test:multi";
    const base = `http://127.0.0.1:${platform.httpPort}`;

    await postInbound(base, { message: "first", sessionKey });
    await postInbound(base, { message: "second", sessionKey });

    const detail = (await platform.invoke("sessions.get", { sessionKey })) as {
      session: { messages: Array<{ role: string; content: string }> } | null;
    };
    expect(detail.session?.messages.length).toBe(4);
    expect(detail.session?.messages.map((m) => m.content)).toEqual([
      "first",
      "echo: first",
      "second",
      "echo: second",
    ]);
  });

  it("gateway chat.send and HTTP share sessionKey history", async () => {
    platform = await createTestPlatform({
      withHttpChannel: true,
      startServer: true,
      startChannels: true,
      withEchoChannel: false,
      withLlmPlugins: false,
      configOverride: {
        agents: [{ id: "default", provider: "builtin", model: "echo" }],
      },
    });

    const sessionKey = "http:shared:session";
    const client = new GatewayWsClient();
    await client.connect(`ws://127.0.0.1:${platform.gatewayPort}`);
    await client.call("chat.send", { message: "from gateway", channelId: "gateway", sessionKey });
    client.close();

    await postInbound(`http://127.0.0.1:${platform.httpPort}`, {
      message: "from http",
      sessionKey,
    });

    const detail = (await platform.invoke("sessions.get", { sessionKey })) as {
      session: { messages: unknown[] } | null;
    };
    expect(detail.session?.messages.length).toBeGreaterThanOrEqual(4);
  });

  it("sessions.list and sessions.reset via WebSocket", async () => {
    platform = await createTestPlatform({
      startServer: true,
      withEchoChannel: false,
      withLlmPlugins: false,
      configOverride: {
        agents: [{ id: "default", provider: "builtin", model: "echo" }],
      },
    });

    const sessionKey = "gateway:default:reset-ws";
    const client = new GatewayWsClient();
    await client.connect(`ws://127.0.0.1:${platform.gatewayPort}`);

    await client.call("chat.send", { message: "hola", channelId: "gateway", sessionKey });

    const list = (await client.call<{ sessions: Array<{ sessionKey: string }> }>("sessions.list"))
      .result;
    expect(list.sessions.some((s) => s.sessionKey === sessionKey)).toBe(true);

    await client.call("sessions.reset", { sessionKey });
    const detail = (await client.call<{ session: null }>("sessions.get", { sessionKey })).result;
    expect(detail.session).toBeNull();

    client.close();
  });
});
