import { describe, it, expect, beforeEach } from "vitest";
import { resetRegistryForTest, registerProvider, registerTool } from "@yggdrasil/kernel";
import { createLlmHarness, LLM_HARNESS_ID } from "./harness.js";
import type { ProviderPlugin } from "@yggdrasil/sdk";

describe("harness-llm", () => {
  beforeEach(() => {
    resetRegistryForTest();
  });

  it("runs attempt via provider chatComplete", async () => {
    const provider: ProviderPlugin = {
      id: "mock-provider",
      label: "Mock",
      listModels: () => [{ id: "m1", label: "M1", provider: "mock-provider" }],
      chatComplete: async () => ({
        text: "mock response",
        model: "m1",
      }),
    };
    registerProvider(provider);

    const harness = createLlmHarness();
    const result = await harness.runAttempt({
      sessionKey: "s1",
      provider: "mock-provider",
      modelId: "m1",
      message: "hello",
      history: [{ role: "user", content: "prev" }],
    });

    expect(result.text).toBe("mock response");
    expect(result.classification).toBe("ok");
    expect(harness.id).toBe(LLM_HARNESS_ID);
  });

  it("returns fallback when api key missing for openai-compat", async () => {
    const provider: ProviderPlugin = {
      id: "openai-compat",
      label: "OpenAI",
      listModels: () => [],
      resolveApiKey: async () => undefined,
      chatComplete: async () => ({ text: "x", model: "m" }),
    };
    registerProvider(provider);

    const harness = createLlmHarness();
    const result = await harness.runAttempt({
      sessionKey: "s1",
      provider: "openai-compat",
      message: "hello",
    });

    expect(result.classification).toBe("fallback");
  });

  it("emits a tool.execute event on the passed-in event bus for every tool call — this is the only place that bridges the tool-loop's onToolExecute into an actual event, so a gateway device tool (which runs through this exact same executeTool/resolveTools path) gets it too", async () => {
    let callCount = 0;
    const provider: ProviderPlugin = {
      id: "mock-provider-tools",
      label: "Mock",
      listModels: () => [],
      chatComplete: async () => {
        callCount++;
        if (callCount === 1) {
          return {
            text: "",
            model: "m1",
            finishReason: "tool_calls",
            toolCalls: [{ id: "c1", name: "echo", arguments: '{"msg":"hi"}' }],
          };
        }
        return { text: "done", model: "m1", finishReason: "stop" };
      },
    };
    registerProvider(provider);
    registerTool({
      name: "echo",
      description: "echo",
      parameters: { type: "object", properties: { msg: { type: "string" } } },
      execute: async (_ctx, args) => ({ echoed: args.msg }),
    });

    const captured: Array<{ event: string; payload: unknown }> = [];
    const events = {
      on: () => () => {},
      off: () => {},
      emit: async (event: string, payload: unknown) => {
        captured.push({ event, payload });
      },
    };

    const harness = createLlmHarness();
    await harness.runAttempt({
      sessionKey: "s-tool-exec",
      provider: "mock-provider-tools",
      modelId: "m1",
      message: "run echo",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      events: events as any,
    });

    const toolExecEvents = captured.filter((e) => e.event === "tool.execute");
    expect(toolExecEvents).toHaveLength(1);
    expect(toolExecEvents[0].payload).toMatchObject({
      sessionKey: "s-tool-exec",
      toolName: "echo",
      status: "ok",
      args: { msg: "hi" },
      result: JSON.stringify({ echoed: "hi" }),
    });
  });
  it("limits tools to the agent's tools.allow list — both what the model sees and what it can execute", async () => {
    let seenToolNames: string[] = [];
    let call = 0;
    const provider: ProviderPlugin = {
      id: "mock-provider-allow",
      label: "Mock",
      listModels: () => [],
      chatComplete: async (_ctx, params) => {
        call++;
        if (call === 1) {
          seenToolNames = (params.tools ?? []).map((t) => t.function.name);
          // The model asks for a tool outside the allowlist by name anyway.
          return {
            text: "",
            model: "m1",
            finishReason: "tool_calls",
            toolCalls: [{ id: "c1", name: "secret_tool", arguments: "{}" }],
          };
        }
        return { text: "done", model: "m1", finishReason: "stop" };
      },
    };
    registerProvider(provider);
    let secretRan = false;
    registerTool({
      name: "phone_alarm",
      description: "alarm",
      parameters: { type: "object", properties: {} },
      execute: async () => "ok",
    });
    registerTool({
      name: "secret_tool",
      description: "not allowed",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        secretRan = true;
        return "leaked";
      },
    });

    const harness = createLlmHarness({
      config: {
        agents: [{ id: "assistant", tools: { allow: ["phone_*"] } }],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    });
    const result = await harness.runAttempt({
      sessionKey: "s-allow",
      provider: "mock-provider-allow",
      modelId: "m1",
      message: "x",
      metadata: { agentId: "assistant" },
    });

    expect(result.classification).toBe("ok");
    expect(seenToolNames).toContain("phone_alarm");
    expect(seenToolNames).not.toContain("secret_tool");
    expect(secretRan).toBe(false);
  });
});
