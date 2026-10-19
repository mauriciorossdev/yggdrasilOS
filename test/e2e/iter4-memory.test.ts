import { describe, it, expect, afterEach } from "vitest";
import {
  createCapturingProviderPlugin,
  createTestPlatform,
  GatewayWsClient,
} from "../helpers/index.js";

describe("iter4 memory e2e", () => {
  let platform: Awaited<ReturnType<typeof createTestPlatform>>;

  afterEach(async () => {
    await platform?.close();
  });

  it("compacts long sessions via WebSocket chat.send", async () => {
    platform = await createTestPlatform({
      startServer: true,
      withEchoChannel: false,
      withLlmPlugins: false,
      configOverride: {
        sessions: {
          maxMessages: 50,
          compactThreshold: 6,
          compactionPolicy: "truncate",
        },
        agents: [{ id: "default", provider: "builtin", model: "echo" }],
      },
    });

    const sessionKey = "gateway:default:compact-ws";
    const client = new GatewayWsClient();
    await client.connect(`ws://127.0.0.1:${platform.gatewayPort}`);

    for (let i = 0; i < 6; i++) {
      await client.call("chat.send", { message: `msg ${i}`, channelId: "gateway", sessionKey });
    }

    const detail = (await client.call<{
      session: { messages: unknown[]; compaction?: { lastCompactedAt?: number } } | null;
    }>("sessions.get", { sessionKey })).result;

    expect(detail.session?.compaction?.lastCompactedAt).toBeDefined();
    expect(detail.session?.messages.length).toBeLessThanOrEqual(12);
    client.close();
  });

  it("sessions.patch via WebSocket persists title and metadata", async () => {
    platform = await createTestPlatform({
      startServer: true,
      withEchoChannel: false,
      withLlmPlugins: false,
      configOverride: {
        agents: [{ id: "default", provider: "builtin", model: "echo" }],
      },
    });

    const sessionKey = "gateway:default:patch-ws";
    const client = new GatewayWsClient();
    await client.connect(`ws://127.0.0.1:${platform.gatewayPort}`);

    await client.call("chat.send", { message: "hola", channelId: "gateway", sessionKey });
    const patched = (
      await client.call<{
        session: { title?: string; metadata?: Record<string, unknown> };
      }>("sessions.patch", { sessionKey, title: "Demo WS", metadata: { topic: "e2e" } })
    ).result;

    expect(patched.session.title).toBe("Demo WS");
    expect(patched.session.metadata).toEqual({ topic: "e2e" });

    const detail = (
      await client.call<{ session: { title?: string } }>("sessions.get", { sessionKey })
    ).result;
    expect(detail.session?.title).toBe("Demo WS");
    client.close();
  });

  it("trimHistoryToTokenBudget via capture provider receives trimmed history", async () => {
    const capturePlugin = createCapturingProviderPlugin("capture-test");
    platform = await createTestPlatform({
      startServer: true,
      bundledPlugins: [capturePlugin],
      configOverride: {
        agents: [{ id: "default", provider: "capture-test", model: "m1" }],
        sessions: { maxTokens: 80, maxMessages: 100, compactThreshold: 200 },
        harness: { compactBeforeTurn: false },
      },
    });

    const sessionKey = "gateway:default:token-trim";
    for (let i = 0; i < 15; i++) {
      await platform.invoke("chat.send", {
        message: `long message number ${i} `.repeat(10),
        channelId: "gateway",
        sessionKey,
      });
    }

    capturePlugin.getLastMessages();
    const captured = capturePlugin.getLastMessages() as unknown[];
    expect(captured.length).toBeLessThan(30);
  });

  it("summarize policy falls back to truncate without API key", async () => {
    const prevKey = process.env.OLLAMA_API_KEY;
    const prevOpenAi = process.env.OPENAI_API_KEY;
    delete process.env.OLLAMA_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      platform = await createTestPlatform({
        startServer: true,
        withEchoChannel: false,
        configOverride: {
          agents: [{ id: "default", provider: "openai-compat", model: "gpt-4o-mini" }],
          sessions: {
            compactThreshold: 4,
            compactionPolicy: "summarize",
            maxMessages: 50,
          },
        },
      });

      const sessionKey = "gateway:default:summarize-fallback";
      const client = new GatewayWsClient();
      await client.connect(`ws://127.0.0.1:${platform.gatewayPort}`);

      for (let i = 0; i < 5; i++) {
        await client.call("chat.send", {
          message: `turn ${i}`,
          channelId: "gateway",
          sessionKey,
        });
      }

      const detail = (
        await client.call<{
          session: { compaction?: { lastCompactedAt?: number }; messages: unknown[] } | null;
        }>("sessions.get", { sessionKey })
      ).result;

      expect(detail.session?.compaction?.lastCompactedAt).toBeDefined();
      client.close();
    } finally {
      if (prevKey) process.env.OLLAMA_API_KEY = prevKey;
      if (prevOpenAi) process.env.OPENAI_API_KEY = prevOpenAi;
    }
  });
});
