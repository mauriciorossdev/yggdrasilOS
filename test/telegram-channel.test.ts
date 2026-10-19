import { describe, it, expect, afterEach, vi } from "vitest";
import telegramPlugin from "../extensions/channel-telegram/src/index.ts";
import { createTestPlatform } from "./helpers/index.js";
import { getChannel } from "@yggdrasil/kernel";

describe("telegram channel", () => {
  let platform: Awaited<ReturnType<typeof createTestPlatform>>;
  const originalFetch = globalThis.fetch;

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    await platform?.close();
  });

  it("polls updates and sends outbound message", async () => {
    const sentMessages: Array<{ chatId: string | number; text: string }> = [];
    let pollCount = 0;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("getUpdates")) {
        pollCount += 1;
        if (pollCount === 1) {
          return new Response(
            JSON.stringify({
              ok: true,
              result: [
                {
                  update_id: 1,
                  message: { message_id: 10, text: "hola telegram", chat: { id: 999 } },
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
      }
      if (url.includes("sendMessage")) {
        const body = JSON.parse(String(init?.body)) as { chat_id: number; text: string };
        sentMessages.push({ chatId: body.chat_id, text: body.text });
        return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: false }), { status: 404 });
    }) as typeof fetch;

    platform = await createTestPlatform({
      startServer: true,
      bundledPlugins: [telegramPlugin],
      withEchoChannel: false,
      withLlmPlugins: false,
      configOverride: {
        agents: [{ id: "default", provider: "builtin", model: "echo" }],
        channels: {
          telegram: {
            enabled: false,
            accounts: { default: { botToken: "test-token", pollingIntervalMs: 10 } },
          },
        },
      },
    });

    expect(getChannel("telegram")?.id).toBe("telegram");

    await platform.server?.channelManager.startChannel("telegram", "default");
    await new Promise((r) => setTimeout(r, 200));
    await platform.server?.channelManager.stopChannel("telegram", "default");

    expect(pollCount).toBeGreaterThan(0);
    expect(sentMessages.some((m) => String(m.chatId) === "999" && m.text.includes("echo:"))).toBe(
      true,
    );
  });
});
