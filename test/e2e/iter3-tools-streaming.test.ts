import { describe, it, expect, afterEach } from "vitest";
import myToolPlugin from "../../extensions/my-tool/src/index.ts";
import {
  createTestPlatform,
  createStreamProviderPlugin,
  createToolLoopProviderPlugin,
  GatewayWsClient,
} from "../helpers/index.js";

describe("iter3 tools and streaming e2e", () => {
  let platform: Awaited<ReturnType<typeof createTestPlatform>>;

  afterEach(async () => {
    await platform?.close();
  });

  it("emits chat.delta during chat.send when harness streams", async () => {
    const streamPlugin = createStreamProviderPlugin("stream-test");
    platform = await createTestPlatform({
      startServer: true,
      bundledPlugins: [streamPlugin],
      configOverride: {
        agents: [{ id: "default", provider: "stream-test", model: "m1" }],
        harness: { streaming: true },
      },
    });

    const client = new GatewayWsClient();
    await client.connect(`ws://127.0.0.1:${platform.gatewayPort}`);
    const { result, events } = await client.call<{ reply: string }>(
      "chat.send",
      { message: "stream me", channelId: "gateway" },
      { collectEvents: true },
    );

    const deltas = events.filter((e) => e.event === "chat.delta");
    expect(deltas.length).toBeGreaterThan(0);
    expect(result.reply).toBe("partial done");
    client.close();
  });

  it("tool loop persists tool_calls in sessions.get", async () => {
    const toolPlugin = createToolLoopProviderPlugin("tool-loop-test");
    platform = await createTestPlatform({
      startServer: true,
      bundledPlugins: [toolPlugin],
      configOverride: {
        agents: [{ id: "default", provider: "tool-loop-test", model: "m1" }],
        harness: { streaming: false, maxToolIterations: 4 },
      },
    });

    const sessionKey = "gateway:default:tool-persist";
    const client = new GatewayWsClient();
    await client.connect(`ws://127.0.0.1:${platform.gatewayPort}`);
    await client.call("chat.send", {
      message: "use echo tool",
      channelId: "gateway",
      sessionKey,
    });
    client.close();

    const detail = (await platform.invoke("sessions.get", { sessionKey })) as {
      session: {
        messages: Array<{
          role: string;
          tool_calls?: Array<{ name: string }>;
          tool_call_id?: string;
        }>;
      } | null;
    };

    const messages = detail.session?.messages ?? [];
    expect(messages.some((m) => m.role === "assistant" && m.tool_calls?.length)).toBe(true);
    expect(messages.some((m) => m.role === "tool" && m.tool_call_id)).toBe(true);
    expect(messages.some((m) => m.role === "assistant" && !m.tool_calls)).toBe(true);
  });

  it("extension tool appears in tools.list", async () => {
    platform = await createTestPlatform({
      bundledPlugins: [myToolPlugin],
      withEchoChannel: false,
      withLlmPlugins: false,
    });

    const result = (await platform.invoke("tools.list", {})) as {
      tools: Array<{ name: string }>;
    };
    expect(result.tools.map((t) => t.name)).toContain("my-tool_echo");
  });

  it("tools.list via WebSocket includes datetime and echo", async () => {
    platform = await createTestPlatform({
      startServer: true,
      withEchoChannel: false,
      withLlmPlugins: false,
    });

    const client = new GatewayWsClient();
    await client.connect(`ws://127.0.0.1:${platform.gatewayPort}`);
    const { result } = await client.call<{ tools: Array<{ name: string; parameters: unknown }> }>(
      "tools.list",
    );
    const names = result.tools.map((t) => t.name);
    expect(names).toContain("datetime");
    expect(names).toContain("echo");
    expect(result.tools.find((t) => t.name === "echo")?.parameters).toBeTruthy();
    client.close();
  });
});
