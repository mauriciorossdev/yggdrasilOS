import { describe, it, expect, beforeEach } from "vitest";
import { DEFAULT_CONFIG, mergeConfig, resolveAgent } from "@yggdrasil/config";
import { resetRegistryForTest } from "@yggdrasil/kernel";
import { registerBuiltinHarnesses } from "@yggdrasil/harness-runtime";
import { runChannelTurn } from "@yggdrasil/pipeline";
import { resetSessionStoreForTest } from "@yggdrasil/sessions";

describe("multi-agent", () => {
  beforeEach(() => {
    resetRegistryForTest();
    resetSessionStoreForTest();
    registerBuiltinHarnesses();
  });

  it("resolves agent by agentId in message metadata", () => {
    const config = mergeConfig(DEFAULT_CONFIG, {
      agents: [
        { id: "default", provider: "builtin" },
        { id: "coder", provider: "builtin", model: "code-echo", label: "Coder" },
      ],
    });

    const defaultAgent = resolveAgent(config, undefined);
    expect(defaultAgent.id).toBe("default");

    const coder = resolveAgent(config, "coder");
    expect(coder.id).toBe("coder");
    expect(coder.label).toBe("Coder");
    expect(coder.model).toBe("code-echo");
  });

  it("routes to correct agent via metadata.agentId in channel turn", async () => {
    const config = mergeConfig(DEFAULT_CONFIG, {
      agents: [
        { id: "default", provider: "builtin", model: "echo" },
        { id: "coder", provider: "builtin", model: "echo" },
      ],
    });

    const result = await runChannelTurn({
      config,
      message: {
        channelId: "test",
        accountId: "default",
        sessionKey: "test:default:user",
        senderId: "user",
        body: "code request",
        metadata: { agentId: "coder" },
      },
    });

    expect(result.admission).toBe("dispatch");
    expect(result.replyText).toBe("echo: code request");
  });

  it("supports systemPrompt in agent config", () => {
    const config = mergeConfig(DEFAULT_CONFIG, {
      agents: [
        { id: "helper", provider: "builtin", systemPrompt: "You are a coding assistant" },
      ],
    });

    const agent = resolveAgent(config, "helper");
    expect(agent.systemPrompt).toBe("You are a coding assistant");
  });
});
