import { describe, it, expect, afterEach } from "vitest";
import { createTestPlatform } from "../helpers/index.js";

describe("gateway RPC integration", () => {
  let platform: Awaited<ReturnType<typeof createTestPlatform>>;

  afterEach(async () => {
    await platform?.close();
  });

  it("sessions.list and sessions.get after chat.send", async () => {
    platform = await createTestPlatform({
      withEchoChannel: false,
      withLlmPlugins: false,
      configOverride: {
        agents: [{ id: "default", provider: "builtin", model: "echo" }],
      },
    });

    const sessionKey = "gateway:default:tester";
    await platform.invoke("chat.send", {
      message: "hola",
      channelId: "gateway",
      sessionKey,
    });

    const list = (await platform.invoke("sessions.list", {})) as {
      sessions: Array<{ sessionKey: string; messageCount: number }>;
    };
    expect(list.sessions.some((s) => s.sessionKey === sessionKey)).toBe(true);

    const detail = (await platform.invoke("sessions.get", { sessionKey })) as {
      session: { messages: Array<{ role: string }> } | null;
    };
    expect(detail.session?.messages.length).toBe(2);

    await platform.invoke("sessions.reset", { sessionKey });
    const afterReset = (await platform.invoke("sessions.get", { sessionKey })) as {
      session: null;
    };
    expect(afterReset.session).toBeNull();
  });

  it("tools.list returns builtin tools", async () => {
    platform = await createTestPlatform({
      withEchoChannel: false,
      withLlmPlugins: false,
      configOverride: {
        agents: [{ id: "default", provider: "builtin", model: "echo" }],
      },
    });

    const result = (await platform.invoke("tools.list", {})) as {
      tools: Array<{ name: string; description: string; parameters: unknown }>;
    };

    const names = result.tools.map((t) => t.name);
    expect(names).toContain("datetime");
    expect(names).toContain("echo");
    expect(result.tools.find((t) => t.name === "echo")?.description).toBeTruthy();
  });

  it("health reports version 0.5.0 and pluginApi", async () => {
    platform = await createTestPlatform({ withEchoChannel: false, withLlmPlugins: false });

    const health = (await platform.invoke("health", {})) as {
      version: string;
      pluginApi: string;
    };
    expect(health.version).toBe("0.5.0");
    expect(health.pluginApi).toBe("0.3.0");
  });
});
