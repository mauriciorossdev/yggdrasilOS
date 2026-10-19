import { describe, it, expect } from "vitest";
import { runToolLoop, type ToolExecuteEvent, type ProviderLatencyEvent } from "./tool-loop.js";
import type { ProviderPlugin, ChatCompleteResult } from "@yggdrasil/sdk";
import type { AgentToolDefinition } from "@yggdrasil/tools-sdk";

function mockProvider(responses: ChatCompleteResult[]): ProviderPlugin {
  let call = 0;
  return {
    id: "mock",
    label: "Mock",
    listModels: () => [],
    chatComplete: async () => responses[call++] ?? { text: "done", model: "m", finishReason: "stop" },
  };
}

const baseTool = {
  type: "function" as const,
  function: { name: "echo", description: "echo", parameters: { type: "object" as const, properties: {} } },
};

describe("tool-loop advanced", () => {
  it("denies tool execution when approveTool returns false", async () => {
    const provider = mockProvider([
      {
        text: "",
        model: "m",
        finishReason: "tool_calls",
        toolCalls: [{ id: "c1", name: "danger", arguments: '{"x":1}' }],
      },
      { text: "denied result", model: "m", finishReason: "stop" },
    ]);

    const toolDef: AgentToolDefinition = {
      name: "danger",
      description: "dangerous",
      requiresApproval: true,
      riskLevel: "destructive",
      parameters: { type: "object", properties: { x: { type: "number" } } },
      async execute() { return { ok: true }; },
    };

    const executed: string[] = [];
    const result = await runToolLoop({
      provider,
      providerCfg: {},
      model: "m",
      sessionKey: "test",
      messages: [{ role: "user", content: "do it" }],
      tools: [baseTool],
      maxIterations: 4,
      executeTool: async (name) => { executed.push(name); return {}; },
      approveTool: async () => false,
      getToolDefinition: (name) => (name === "danger" ? toolDef : undefined),
    });

    expect(executed).toEqual([]);
    expect(result.sessionAppend?.some((m) => m.content === "Error: tool execution denied by user")).toBe(true);
  });

  it("approves tool execution when approveTool returns true", async () => {
    const provider = mockProvider([
      {
        text: "",
        model: "m",
        finishReason: "tool_calls",
        toolCalls: [{ id: "c1", name: "safe-tool", arguments: '{}' }],
      },
      { text: "approved result", model: "m", finishReason: "stop" },
    ]);

    const toolDef: AgentToolDefinition = {
      name: "safe-tool",
      description: "safe",
      requiresApproval: true,
      parameters: { type: "object", properties: {} },
      async execute() { return { ok: true }; },
    };

    const executed: string[] = [];
    const result = await runToolLoop({
      provider,
      providerCfg: {},
      model: "m",
      sessionKey: "test",
      messages: [{ role: "user", content: "do it" }],
      tools: [baseTool],
      maxIterations: 4,
      executeTool: async (name) => { executed.push(name); return { ok: true }; },
      approveTool: async () => true,
      getToolDefinition: (name) => (name === "safe-tool" ? toolDef : undefined),
    });

    expect(executed).toEqual(["safe-tool"]);
    expect(result.text).toBe("approved result");
  });

  it("executes parallel tool calls concurrently", async () => {
    const timestamps: number[] = [];
    const provider = mockProvider([
      {
        text: "",
        model: "m",
        finishReason: "tool_calls",
        toolCalls: [
          { id: "c1", name: "slow1", arguments: '{}' },
          { id: "c2", name: "slow2", arguments: '{}' },
        ],
      },
      { text: "parallel done", model: "m", finishReason: "stop" },
    ]);

    const result = await runToolLoop({
      provider,
      providerCfg: {},
      model: "m",
      sessionKey: "test",
      messages: [{ role: "user", content: "both" }],
      tools: [baseTool],
      maxIterations: 4,
      parallelToolCalls: true,
      executeTool: async (name) => {
        timestamps.push(Date.now());
        await new Promise((r) => setTimeout(r, 50));
        return { tool: name };
      },
    });

    expect(result.text).toBe("parallel done");
    expect(result.sessionAppend?.filter((m) => m.role === "tool")).toHaveLength(2);
    // Both should start within ~10ms of each other (parallel)
    if (timestamps.length === 2) {
      expect(Math.abs(timestamps[1] - timestamps[0])).toBeLessThan(30);
    }
  });

  it("preserves tool message order matching toolCalls array", async () => {
    const provider = mockProvider([
      {
        text: "",
        model: "m",
        finishReason: "tool_calls",
        toolCalls: [
          { id: "c1", name: "first", arguments: '{}' },
          { id: "c2", name: "second", arguments: '{}' },
        ],
      },
      { text: "ordered", model: "m", finishReason: "stop" },
    ]);

    const result = await runToolLoop({
      provider,
      providerCfg: {},
      model: "m",
      sessionKey: "test",
      messages: [{ role: "user", content: "order" }],
      tools: [baseTool],
      maxIterations: 4,
      parallelToolCalls: true,
      executeTool: async (name) => {
        if (name === "first") await new Promise((r) => setTimeout(r, 30));
        return { name };
      },
    });

    const toolMsgs = result.sessionAppend?.filter((m) => m.role === "tool") ?? [];
    expect(toolMsgs[0]?.name).toBe("first");
    expect(toolMsgs[1]?.name).toBe("second");
  });

  it("emits onToolExecute and onProviderLatency callbacks", async () => {
    const toolEvents: ToolExecuteEvent[] = [];
    const latencyEvents: ProviderLatencyEvent[] = [];
    const provider = mockProvider([
      {
        text: "",
        model: "m",
        finishReason: "tool_calls",
        toolCalls: [{ id: "c1", name: "t1", arguments: '{}' }],
      },
      { text: "done", model: "m", finishReason: "stop" },
    ]);

    await runToolLoop({
      provider,
      providerCfg: {},
      model: "m",
      sessionKey: "test",
      messages: [{ role: "user", content: "x" }],
      tools: [baseTool],
      maxIterations: 4,
      executeTool: async () => ({ ok: true }),
      onToolExecute: (e) => toolEvents.push(e),
      onProviderLatency: (e) => latencyEvents.push(e),
    });

    expect(toolEvents).toHaveLength(1);
    expect(toolEvents[0].name).toBe("t1");
    expect(toolEvents[0].ok).toBe(true);
    expect(toolEvents[0].durationMs).toBeGreaterThanOrEqual(0);

    expect(latencyEvents.length).toBeGreaterThanOrEqual(1);
    expect(latencyEvents[0].model).toBe("m");
    expect(latencyEvents[0].durationMs).toBeGreaterThanOrEqual(0);
  });
});
