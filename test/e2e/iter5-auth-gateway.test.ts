import { describe, it, expect, afterEach } from "vitest";
import { createTestPlatform, GatewayWsClient } from "../helpers/index.js";

describe("iter5 gateway auth e2e", () => {
  let platform: Awaited<ReturnType<typeof createTestPlatform>>;

  afterEach(async () => {
    await platform?.close();
  });

  it("rejects chat.send without auth when apiKey required", async () => {
    platform = await createTestPlatform({
      startServer: true,
      configOverride: {
        auth: { gateway: { apiKey: "gw-secret", required: true } },
        agents: [{ id: "default", provider: "builtin", model: "echo" }],
      },
    });

    const client = new GatewayWsClient();
    await client.connect(`ws://127.0.0.1:${platform.gatewayPort}`);

    await expect(
      client.call("chat.send", { message: "hola", channelId: "gateway" }),
    ).rejects.toThrow(/UNAUTHORIZED/);
    client.close();
  });

  it("allows chat.send after auth handshake", async () => {
    platform = await createTestPlatform({
      startServer: true,
      configOverride: {
        auth: { gateway: { apiKey: "gw-secret", required: true } },
        agents: [{ id: "default", provider: "builtin", model: "echo" }],
      },
    });

    const client = new GatewayWsClient();
    await client.connect(`ws://127.0.0.1:${platform.gatewayPort}`);

    const auth = await client.call<{ ok: boolean }>("auth", { apiKey: "gw-secret" });
    expect(auth.result.ok).toBe(true);

    const chat = await client.call<{ reply: string }>("chat.send", {
      message: "hola",
      channelId: "gateway",
    });
    expect(chat.result.reply).toBe("echo: hola");
    client.close();
  });
});
