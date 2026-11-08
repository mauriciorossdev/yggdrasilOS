import { afterEach, describe, expect, it } from "vitest";
import type { YggdrasilPlugin } from "@yggdrasil/sdk";
import { createTestPlatform, GatewayWsClient } from "../helpers/index.js";

// A provider whose first reply is empty: the tool loop retries once, and the guard must be visible to clients.
let calls = 0;
const flakyProvider: YggdrasilPlugin = {
  id: "flaky-provider-plugin",
  register(api) {
    api.registerProvider({
      id: "flaky",
      label: "Flaky",
      listModels: () => [{ id: "m1", label: "M1", provider: "flaky" }],
      chatComplete: async (_ctx, params) => {
        calls += 1;
        if (calls === 1) params.onRetry?.({ attempt: 1, delayMs: 50, reason: "HTTP 500" });
        return { text: calls === 1 ? "" : "second try worked", model: "m1", finishReason: "stop" as const };
      },
    });
  },
};

describe("loop.guard event", () => {
  let platform: Awaited<ReturnType<typeof createTestPlatform>>;
  afterEach(async () => {
    await platform?.close();
  });

  it("reaches the client when the loop retries an empty reply", async () => {
    calls = 0;
    platform = await createTestPlatform({
      startServer: true,
      bundledPlugins: [flakyProvider],
      configOverride: {
        agents: [{ id: "default", provider: "flaky", model: "m1" }],
        harness: { streaming: false },
      },
    });
    const client = new GatewayWsClient();
    await client.connect(`ws://127.0.0.1:${platform.gatewayPort}`);
    const { result, events } = await client.call<{ reply: string }>(
      "chat.send",
      { message: "hi", channelId: "gateway", sessionKey: "gateway:default:guard" },
      { collectEvents: true },
    );
    expect(result.reply).toBe("second try worked");
    const guard = events.find((e) => e.event === "loop.guard");
    expect(guard?.payload).toMatchObject({ kind: "empty-retry", sessionKey: "gateway:default:guard" });
    client.close();
  });

  it("reaches the client when the provider retries a request", async () => {
    calls = 0;
    platform = await createTestPlatform({
      startServer: true,
      bundledPlugins: [flakyProvider],
      configOverride: { agents: [{ id: "default", provider: "flaky", model: "m1" }], harness: { streaming: false } },
    });
    const client = new GatewayWsClient();
    await client.connect(`ws://127.0.0.1:${platform.gatewayPort}`);
    const { events } = await client.call("chat.send", { message: "hi", channelId: "gateway", sessionKey: "gateway:default:retry" }, { collectEvents: true });
    const retry = events.find((e) => e.event === "provider.retry");
    expect(retry?.payload).toMatchObject({ attempt: 1, reason: "HTTP 500", sessionKey: "gateway:default:retry" });
    client.close();
  });
});
