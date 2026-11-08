import { describe, it, expect, afterEach } from "vitest";
import type { YggdrasilPlugin } from "@yggdrasil/sdk";
import { createTestPlatform, GatewayWsClient } from "./../helpers/index.js";

// A provider that streams a first chunk and then never finishes — only a cancel can end the turn.
const hangingProviderPlugin: YggdrasilPlugin = {
  id: "hanging-provider-plugin",
  register(api) {
    api.registerProvider({
      id: "hanging",
      label: "Hanging",
      listModels: () => [{ id: "m1", label: "M1", provider: "hanging" }],
      chatComplete: () => new Promise(() => {}),
      chatCompleteStream: (_ctx, _params, onEvent) => {
        onEvent({ type: "delta", text: "thinking out loud" });
        return new Promise(() => {});
      },
    });
  },
};

describe("chat.cancel e2e", () => {
  let platform: Awaited<ReturnType<typeof createTestPlatform>>;
  const clients: GatewayWsClient[] = [];

  afterEach(async () => {
    clients.splice(0).forEach((c) => c.close());
    await platform?.close();
  });

  it("ends a running turn, keeps the streamed text and reports it as cancelled", async () => {
    platform = await createTestPlatform({
      startServer: true,
      bundledPlugins: [hangingProviderPlugin],
      configOverride: {
        agents: [{ id: "default", provider: "hanging", model: "m1" }],
        harness: { streaming: true },
      },
    });
    const url = `ws://127.0.0.1:${platform.gatewayPort}`;
    const sender = new GatewayWsClient();
    const canceller = new GatewayWsClient();
    clients.push(sender, canceller);
    await sender.connect(url);
    await canceller.connect(url);

    const sessionKey = "tui:default:cancel-e2e";
    // Cancel only once the first chunk is out; a fixed wait raced the turn's setup on slow machines.
    const firstDelta = sender.waitForEvent("chat.delta");
    const sending = sender.call<{ reply: string }>(
      "chat.send",
      { message: "go", channelId: "tui", sessionKey },
      { collectEvents: true, timeoutMs: 10_000 },
    );

    await firstDelta;
    const { result: cancel } = await canceller.call<{ cancelled: boolean }>("chat.cancel", { sessionKey });
    expect(cancel.cancelled).toBe(true);

    const { result, events } = await sending;
    expect(result.reply).toBe("thinking out loud\n\n(cancelled)");
    const turnEnd = events.find((e) => e.event === "turn.end");
    expect((turnEnd?.payload as { classification?: string }).classification).toBe("cancelled");

    // The turn is over, so a second cancel has nothing to stop.
    const { result: again } = await canceller.call<{ cancelled: boolean }>("chat.cancel", { sessionKey });
    expect(again.cancelled).toBe(false);
  });
});
