import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DEFAULT_CONFIG, mergeConfig } from "@yggdrasil/config";
import { registerHarness, resetRegistryForTest } from "@yggdrasil/kernel";
import { registerBuiltinHarnesses } from "@yggdrasil/harness-runtime";
import { runChannelTurn } from "@yggdrasil/pipeline";
import { SessionStore, resetSessionStoreForTest, initSessionStore } from "@yggdrasil/sessions";

describe("pipeline", () => {
  let dir: string;

  beforeEach(async () => {
    resetRegistryForTest();
    resetSessionStoreForTest();
    registerBuiltinHarnesses();
    dir = await mkdtemp(join(tmpdir(), "yggdrasil-pipeline-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    resetSessionStoreForTest();
  });

  it("runs channel turn with echo harness for builtin provider", async () => {
    const config = mergeConfig(DEFAULT_CONFIG, {
      agents: [{ id: "default", provider: "builtin", model: "echo" }],
    });

    const result = await runChannelTurn({
      config,
      message: {
        channelId: "test",
        accountId: "default",
        sessionKey: "test:default:user",
        senderId: "user",
        body: "hello",
      },
    });

    expect(result.admission).toBe("dispatch");
    expect(result.replyText).toBe("echo: hello");
    expect(result.harnessId).toBe("builtin-echo");
  });

  it("persists multi-turn history in session store", async () => {
    const config = mergeConfig(DEFAULT_CONFIG, {
      agents: [{ id: "default", provider: "builtin", model: "echo" }],
      sessions: { dir, maxMessages: 20 },
    });
    const store = initSessionStore(config);

    await runChannelTurn({
      config,
      sessionStore: store,
      message: {
        channelId: "test",
        accountId: "default",
        sessionKey: "test:default:user",
        senderId: "user",
        body: "first",
      },
    });

    await runChannelTurn({
      config,
      sessionStore: store,
      message: {
        channelId: "test",
        accountId: "default",
        sessionKey: "test:default:user",
        senderId: "user",
        body: "second",
      },
    });

    const record = await store.get("test:default:user");
    expect(record?.messages).toHaveLength(4);
    expect(record?.messages.map((m) => m.content)).toEqual([
      "first",
      "echo: first",
      "second",
      "echo: second",
    ]);
  });

  it("honors a per-message provider/model override over the agent's own config", async () => {
    registerHarness({
      id: "mock-override-harness",
      label: "Mock Override Harness",
      supports: (ctx) => ({ supported: ctx.provider === "override-provider", priority: 50 }),
      runAttempt: async ({ modelId }) => ({ text: `used:${modelId}`, classification: "ok" }),
    });

    const config = mergeConfig(DEFAULT_CONFIG, {
      agents: [{ id: "default", provider: "builtin", model: "echo" }],
    });

    const result = await runChannelTurn({
      config,
      message: {
        channelId: "test",
        accountId: "default",
        sessionKey: "test:default:user3",
        senderId: "user",
        body: "hi",
        metadata: { provider: "override-provider", model: "override-model" },
      },
    });

    expect(result.harnessId).toBe("mock-override-harness");
    expect(result.replyText).toBe("used:override-model");
  });

  it("appends the configured language as a system instruction on top of the agent's own system prompt", async () => {
    registerHarness({
      id: "mock-history-echo-harness",
      label: "Mock History Echo Harness",
      supports: (ctx) => ({ supported: ctx.provider === "history-echo-provider", priority: 50 }),
      runAttempt: async ({ history }) => ({
        text: (history ?? []).filter((m) => m.role === "system").map((m) => m.content).join(" ||| "),
        classification: "ok",
      }),
    });

    const config = mergeConfig(DEFAULT_CONFIG, {
      agents: [{ id: "default", provider: "history-echo-provider", model: "x", systemPrompt: "You are helpful." }],
      language: "Spanish",
    });

    const result = await runChannelTurn({
      config,
      message: {
        channelId: "test",
        accountId: "default",
        sessionKey: "test:default:lang",
        senderId: "user",
        body: "hi",
      },
    });

    expect(result.replyText).toContain("You are helpful.");
    expect(result.replyText).toContain("Always respond in Spanish");
  });

  it("doesn't add a language instruction when none is configured", async () => {
    registerHarness({
      id: "mock-history-echo-harness-2",
      label: "Mock History Echo Harness 2",
      supports: (ctx) => ({ supported: ctx.provider === "history-echo-provider-2", priority: 50 }),
      runAttempt: async ({ history }) => ({
        text: (history ?? []).filter((m) => m.role === "system").map((m) => m.content).join(" ||| "),
        classification: "ok",
      }),
    });

    const config = mergeConfig(DEFAULT_CONFIG, {
      agents: [{ id: "default", provider: "history-echo-provider-2", model: "x", systemPrompt: "You are helpful." }],
    });

    const result = await runChannelTurn({
      config,
      message: {
        channelId: "test",
        accountId: "default",
        sessionKey: "test:default:nolang",
        senderId: "user",
        body: "hi",
      },
    });

    // No language instruction — but the mode-status line is always present
    // (defaults to "auto" when no approvalMode is passed).
    expect(result.replyText).not.toContain("Always respond in");
    expect(result.replyText).toContain("You are helpful.");
    expect(result.replyText).toContain("Tool-approval mode: Auto.");
  });

  it("keeps a globally-pinned harness on a fallback classification instead of silently swapping to echo — pinned means no automatic harness-switching", async () => {
    registerHarness({
      id: "pinned-fallback-harness",
      label: "Pinned Fallback Harness",
      // Deliberately never wins auto-selection — this test only reaches it
      // via harness.policy:"pinned", never via the auto/priority path.
      supports: () => ({ supported: false, priority: 0 }),
      runAttempt: async () => ({
        text: 'No provider registered for "builtin"',
        classification: "fallback",
      }),
    });

    const config = mergeConfig(DEFAULT_CONFIG, {
      agents: [{ id: "default", provider: "builtin" }],
      harness: { policy: "pinned", pinnedId: "pinned-fallback-harness" },
    });

    const result = await runChannelTurn({
      config,
      message: {
        channelId: "test",
        accountId: "default",
        sessionKey: "test:default:pinned-fallback",
        senderId: "user",
        body: "hi",
      },
    });

    expect(result.harnessId).toBe("pinned-fallback-harness");
    expect(result.replyText).toBe('No provider registered for "builtin"');
  });

  it("keeps an agent-level pinned harness on a fallback classification too", async () => {
    registerHarness({
      id: "agent-pinned-fallback-harness",
      label: "Agent Pinned Fallback Harness",
      supports: () => ({ supported: false, priority: 0 }),
      runAttempt: async () => ({ text: "still no provider", classification: "fallback" }),
    });

    const config = mergeConfig(DEFAULT_CONFIG, {
      agents: [{ id: "default", provider: "builtin", harness: "agent-pinned-fallback-harness" }],
    });

    const result = await runChannelTurn({
      config,
      message: {
        channelId: "test",
        accountId: "default",
        sessionKey: "test:default:agent-pinned-fallback",
        senderId: "user",
        body: "hi",
      },
    });

    expect(result.harnessId).toBe("agent-pinned-fallback-harness");
    expect(result.replyText).toBe("still no provider");
  });
});
