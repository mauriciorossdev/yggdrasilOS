import { describe, it, expect, afterEach } from "vitest";
import { createTestPlatform } from "../helpers/index.js";

describe("sessions compaction integration", () => {
  let platform: Awaited<ReturnType<typeof createTestPlatform>>;

  afterEach(async () => {
    await platform?.close();
  });

  it("compacts long sessions before next turn", async () => {
    platform = await createTestPlatform({
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

    const sessionKey = "gateway:default:compact-user";
    for (let i = 0; i < 6; i++) {
      await platform.invoke("chat.send", { message: `msg ${i}`, sessionKey });
    }

    const detail = (await platform.invoke("sessions.get", { sessionKey })) as {
      session: { messages: unknown[]; compaction?: { lastCompactedAt?: number } } | null;
    };

    expect(detail.session?.compaction?.lastCompactedAt).toBeDefined();
    expect(detail.session?.messages.length).toBeLessThanOrEqual(12);
  });

  it("sessions.patch persists title via gateway", async () => {
    platform = await createTestPlatform({
      withEchoChannel: false,
      withLlmPlugins: false,
      configOverride: {
        agents: [{ id: "default", provider: "builtin", model: "echo" }],
      },
    });

    const sessionKey = "gateway:default:patch-user";
    await platform.invoke("chat.send", { message: "hola", sessionKey });

    const patched = (await platform.invoke("sessions.patch", {
      sessionKey,
      title: "Pruebas",
      metadata: { topic: "demo" },
    })) as { session: { title?: string; metadata?: Record<string, unknown> } };

    expect(patched.session.title).toBe("Pruebas");
    expect(patched.session.metadata).toEqual({ topic: "demo" });
  });
});
