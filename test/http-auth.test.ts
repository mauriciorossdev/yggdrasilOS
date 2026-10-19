import { describe, it, expect, afterEach } from "vitest";
import { createTestPlatform, postInbound } from "./helpers/index.js";

describe("http auth", () => {
  let platform: Awaited<ReturnType<typeof createTestPlatform>>;

  afterEach(async () => {
    await platform?.close();
  });

  it("returns 401 without Bearer when auth.http.apiKey is set", async () => {
    platform = await createTestPlatform({
      withHttpChannel: true,
      startServer: true,
      startChannels: true,
      withEchoChannel: false,
      withLlmPlugins: false,
      configOverride: {
        auth: { http: { apiKey: "test-secret" } },
        agents: [{ id: "default", provider: "builtin", model: "echo" }],
      },
    });

    const response = await postInbound(`http://127.0.0.1:${platform.httpPort}`, {
      message: "hola",
      sessionKey: "http:auth:test",
    });
    expect(response.status).toBe(401);
  });

  it("returns 200 with valid Bearer token", async () => {
    platform = await createTestPlatform({
      withHttpChannel: true,
      startServer: true,
      startChannels: true,
      withEchoChannel: false,
      withLlmPlugins: false,
      configOverride: {
        auth: { http: { apiKey: "test-secret" } },
        agents: [{ id: "default", provider: "builtin", model: "echo" }],
      },
    });

    const response = await postInbound(`http://127.0.0.1:${platform.httpPort}`, {
      message: "hola",
      sessionKey: "http:auth:ok",
      headers: { Authorization: "Bearer test-secret" },
    });
    expect(response.status).toBe(200);
    const body = response.body as { reply: string };
    expect(body.reply).toBe("echo: hola");
  });
});
