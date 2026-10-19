import { describe, it, expect, afterEach } from "vitest";
import { createTestPlatform, GatewayWsClient } from "../helpers/index.js";

describe("iter8 chat stream e2e", () => {
  let platform: Awaited<ReturnType<typeof createTestPlatform>>;

  afterEach(async () => {
    await platform?.close();
  });

  it("chat.send emits chat.final over WebSocket", async () => {
    platform = await createTestPlatform({
      startServer: true,
      configOverride: {
        agents: [{ id: "default", provider: "builtin", model: "echo" }],
      },
    });

    const client = new GatewayWsClient();
    await client.connect(`ws://127.0.0.1:${platform.gatewayPort}`);

    const chat = await client.call<{ reply: string }>(
      "chat.send",
      {
        message: "hola web",
        channelId: "web",
        sessionKey: "web:default:user",
      },
      { collectEvents: true },
    );

    expect(chat.result.reply).toBe("echo: hola web");
    expect(chat.events.some((e) => e.event === "chat.final")).toBe(true);
    client.close();
  });
});
