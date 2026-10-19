import { describe, it, expect, afterEach } from "vitest";
import { listChannels } from "@yggdrasil/kernel";
import { createTestPlatform, GatewayWsClient } from "../helpers/index.js";

describe("iter1 spine e2e", () => {
  let platform: Awaited<ReturnType<typeof createTestPlatform>>;

  afterEach(async () => {
    await platform?.close();
  });

  it("health via WebSocket", async () => {
    platform = await createTestPlatform({ startServer: true });
    const client = new GatewayWsClient();
    await client.connect(`ws://127.0.0.1:${platform.gatewayPort}`);
    const { result } = await client.call<{ ok: boolean; version: string; pluginApi: string }>(
      "health",
    );
    expect(result.ok).toBe(true);
    expect(result.version).toBe("0.5.0");
    expect(result.pluginApi).toBe("0.3.0");
    client.close();
  });

  it("plugins.list, harnesses.list, channels.status", async () => {
    platform = await createTestPlatform({ startServer: true });

    const client = new GatewayWsClient();
    await client.connect(`ws://127.0.0.1:${platform.gatewayPort}`);

    const plugins = (await client.call<{ plugins: Array<{ id: string }> }>("plugins.list"))
      .result;
    expect(plugins.plugins.some((p) => p.id === "echo-channel")).toBe(true);

    const harnesses = (await client.call<{ harnesses: Array<{ id: string }> }>("harnesses.list"))
      .result;
    expect(harnesses.harnesses.some((h) => h.id === "builtin-echo")).toBe(true);
    expect(harnesses.harnesses.some((h) => h.id === "llm")).toBe(true);

    const channels = (await client.call<{ channels: Array<{ id: string }> }>("channels.status"))
      .result;
    expect(channels.channels.length).toBeGreaterThan(0);

    client.close();
  });

  it("chat.send over WebSocket returns echo reply", async () => {
    platform = await createTestPlatform({
      startServer: true,
      configOverride: {
        agents: [{ id: "default", provider: "builtin", model: "echo" }],
      },
    });

    const client = new GatewayWsClient();
    await client.connect(`ws://127.0.0.1:${platform.gatewayPort}`);
    const { result } = await client.call<{ reply: string }>("chat.send", {
      message: "ping",
      channelId: "gateway",
    });
    expect(result.reply).toBe("echo: ping");
    client.close();
  });

  it("chat.final event emitted on chat.send", async () => {
    platform = await createTestPlatform({
      startServer: true,
      configOverride: {
        agents: [{ id: "default", provider: "builtin", model: "echo" }],
      },
    });

    const client = new GatewayWsClient();
    await client.connect(`ws://127.0.0.1:${platform.gatewayPort}`);
    const { result, events } = await client.call<{ reply: string; sessionKey: string }>(
      "chat.send",
      { message: "event test", channelId: "gateway", sessionKey: "gateway:default:evt" },
      { collectEvents: true },
    );

    expect(result.reply).toBe("echo: event test");
    const finals = events.filter((e) => e.event === "chat.final");
    expect(finals.length).toBeGreaterThan(0);
    expect((finals[0]?.payload as { text?: string })?.text).toBe("echo: event test");
    client.close();
  });

  it("channels.start and channels.stop", async () => {
    platform = await createTestPlatform({ startServer: true });

    const client = new GatewayWsClient();
    await client.connect(`ws://127.0.0.1:${platform.gatewayPort}`);

    const started = (
      await client.call<{ started: boolean }>("channels.start", {
        channelId: "echo",
        accountId: "default",
      })
    ).result;
    expect(started.started).toBe(true);

    const stopped = (
      await client.call<{ stopped: boolean }>("channels.stop", {
        channelId: "echo",
        accountId: "default",
      })
    ).result;
    expect(stopped.stopped).toBe(true);

    client.close();
  });

  it("discovers echo channel extension", async () => {
    platform = await createTestPlatform();
    expect(listChannels().some((c) => c.id === "echo")).toBe(true);
  });
});
