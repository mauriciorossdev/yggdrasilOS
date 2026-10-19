import { describe, it, expect, afterEach } from "vitest";
import {
  createStreamProviderPlugin,
  createTestPlatform,
  postInbound,
} from "./helpers/index.js";

describe("http SSE", () => {
  let platform: Awaited<ReturnType<typeof createTestPlatform>>;

  afterEach(async () => {
    await platform?.close();
  });

  it("streams delta and final events with Accept text/event-stream", async () => {
    const streamPlugin = createStreamProviderPlugin("sse-test");
    platform = await createTestPlatform({
      withHttpChannel: true,
      startServer: true,
      startChannels: true,
      withEchoChannel: false,
      bundledPlugins: [streamPlugin],
      configOverride: {
        agents: [{ id: "default", provider: "sse-test", model: "m1" }],
        harness: { streaming: true },
      },
    });

    const response = await postInbound(`http://127.0.0.1:${platform.httpPort}`, {
      message: "stream me",
      sessionKey: "http:sse:test",
      accept: "text/event-stream",
    });

    expect(response.status).toBe(200);
    const events = response.events ?? [];
    expect(events.some((e) => e.event === "delta")).toBe(true);
    expect(events.some((e) => e.event === "final")).toBe(true);
    const final = events.find((e) => e.event === "final")?.data as { reply?: string };
    expect(final?.reply).toBe("partial done");
  });
});
