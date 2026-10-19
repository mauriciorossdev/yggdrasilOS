import { describe, it, expect, beforeEach } from "vitest";
import { resetRegistryForTest, registerProvider } from "@yggdrasil/kernel";
import { runToolLoop } from "./tool-loop.js";
import type { ProviderPlugin } from "@yggdrasil/sdk";

describe("tool-loop", () => {
  beforeEach(() => {
    resetRegistryForTest();
  });

  it("executes tools and re-prompts until stop", async () => {
    let call = 0;
    const provider: ProviderPlugin = {
      id: "mock",
      label: "Mock",
      listModels: () => [],
      chatComplete: async () => {
        call += 1;
        if (call === 1) {
          return {
            text: "",
            model: "m",
            finishReason: "tool_calls",
            toolCalls: [{ id: "c1", name: "echo", arguments: '{"message":"hi"}' }],
          };
        }
        return { text: "done after tool", model: "m", finishReason: "stop" };
      },
    };
    registerProvider(provider);

    const executed: string[] = [];
    const result = await runToolLoop({
      provider,
      providerCfg: {},
      model: "m",
      messages: [{ role: "user", content: "test" }],
      tools: [
        {
          type: "function",
          function: {
            name: "echo",
            description: "echo",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
      maxIterations: 4,
      executeTool: async (name) => {
        executed.push(name);
        return { ok: true };
      },
    });

    expect(executed).toEqual(["echo"]);
    expect(result.text).toBe("done after tool");
    expect(result.classification).toBe("ok");
    expect(result.sessionAppend).toHaveLength(2);
    expect(result.sessionAppend?.[0]?.tool_calls?.[0]?.name).toBe("echo");
    expect(result.sessionAppend?.[1]?.role).toBe("tool");
  });

  it("forwards base64/mimeType through onToolExecute's `image` field for a __ygg_image__ sentinel result", async () => {
    let call = 0;
    const provider: ProviderPlugin = {
      id: "mock-image",
      label: "Mock",
      listModels: () => [],
      chatComplete: async () => {
        call += 1;
        if (call === 1) {
          return {
            text: "",
            model: "m",
            finishReason: "tool_calls",
            toolCalls: [{ id: "c1", name: "screenshot", arguments: "{}" }],
          };
        }
        return { text: "done", model: "m", finishReason: "stop" };
      },
    };
    registerProvider(provider);

    const events: Array<{ image?: { base64: string; mimeType: string; path?: string } }> = [];
    await runToolLoop({
      provider,
      providerCfg: {},
      model: "m",
      messages: [{ role: "user", content: "test" }],
      tools: [
        { type: "function", function: { name: "screenshot", description: "screenshot", parameters: { type: "object", properties: {} } } },
      ],
      maxIterations: 4,
      executeTool: async () => ({ __ygg_image__: true, base64: "abc123", mimeType: "image/png" }),
      onToolExecute: (event) => events.push(event),
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.image).toEqual({ base64: "abc123", mimeType: "image/png", path: undefined });
  });

  it("streams deltas when provider supports chatCompleteStream", async () => {
    const provider: ProviderPlugin = {
      id: "stream-mock",
      label: "Stream",
      listModels: () => [],
      chatComplete: async () => ({ text: "fallback", model: "m" }),
      chatCompleteStream: async (_ctx, _params, onEvent) => {
        onEvent({ type: "delta", text: "hel" });
        onEvent({ type: "delta", text: "lo" });
        const result = { text: "hello", model: "m", finishReason: "stop" as const };
        onEvent({ type: "done", result });
        return result;
      },
    };

    const deltas: string[] = [];
    const result = await runToolLoop({
      provider,
      providerCfg: {},
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      maxIterations: 2,
      streaming: true,
      onDelta: (d) => deltas.push(d),
      executeTool: async () => ({}),
    });

    expect(deltas).toEqual(["hel", "lo"]);
    expect(result.text).toBe("hello");
  });

  describe("approvalMode override", () => {
    function providerCallingTool(toolName: string): ProviderPlugin {
      let call = 0;
      return {
        id: "mock",
        label: "Mock",
        listModels: () => [],
        chatComplete: async () => {
          call += 1;
          if (call === 1) {
            return {
              text: "",
              model: "m",
              finishReason: "tool_calls",
              toolCalls: [{ id: "c1", name: toolName, arguments: "{}" }],
            };
          }
          return { text: "done", model: "m", finishReason: "stop" };
        },
      };
    }

    const toolDef = { type: "function" as const, function: { name: "danger", description: "d", parameters: { type: "object" as const, properties: {} } } };

    it('"yolo" skips approval even for a destructive tool', async () => {
      const provider = providerCallingTool("danger");
      const approveTool = async () => false; // would deny if ever asked
      const result = await runToolLoop({
        provider,
        providerCfg: {},
        model: "m",
        messages: [{ role: "user", content: "test" }],
        tools: [toolDef],
        maxIterations: 4,
        approveTool,
        approvalMode: "yolo",
        getToolDefinition: () => ({
          name: "danger",
          description: "d",
          parameters: { type: "object", properties: {} },
          riskLevel: "destructive",
        }),
        executeTool: async () => ({ ok: true }),
      });
      expect(result.text).toBe("done");
      expect(result.sessionAppend?.[1]?.content).not.toMatch(/denied/);
    });

    it('"restrict" requires approval even for a tool with no riskLevel set', async () => {
      const provider = providerCallingTool("danger");
      let asked = false;
      const approveTool = async () => {
        asked = true;
        return true;
      };
      const result = await runToolLoop({
        provider,
        providerCfg: {},
        model: "m",
        messages: [{ role: "user", content: "test" }],
        tools: [toolDef],
        maxIterations: 4,
        approveTool,
        approvalMode: "restrict",
        getToolDefinition: () => ({
          name: "danger",
          description: "d",
          parameters: { type: "object", properties: {} },
        }),
        executeTool: async () => ({ ok: true }),
      });
      expect(asked).toBe(true);
      expect(result.text).toBe("done");
    });

    it('"restrict" denial produces the standard "denied by user" tool result', async () => {
      const provider = providerCallingTool("danger");
      const result = await runToolLoop({
        provider,
        providerCfg: {},
        model: "m",
        messages: [{ role: "user", content: "test" }],
        tools: [toolDef],
        maxIterations: 4,
        approveTool: async () => false,
        approvalMode: "restrict",
        getToolDefinition: () => ({
          name: "danger",
          description: "d",
          parameters: { type: "object", properties: {} },
        }),
        executeTool: async () => ({ ok: true }),
      });
      expect(result.sessionAppend?.[1]?.content).toMatch(/denied by user/);
    });

    it('"plan" auto-denies a risky tool without ever calling approveTool', async () => {
      const provider = providerCallingTool("danger");
      let asked = false;
      const result = await runToolLoop({
        provider,
        providerCfg: {},
        model: "m",
        messages: [{ role: "user", content: "test" }],
        tools: [toolDef],
        maxIterations: 4,
        approveTool: async () => {
          asked = true;
          return true;
        },
        approvalMode: "plan",
        getToolDefinition: () => ({
          name: "danger",
          description: "d",
          parameters: { type: "object", properties: {} },
          riskLevel: "destructive",
        }),
        executeTool: async () => ({ ok: true }),
      });
      expect(asked).toBe(false);
      expect(result.sessionAppend?.[1]?.content).toMatch(/blocked.*plan mode/i);
    });

    it('"plan" still runs a safe tool silently', async () => {
      const provider = providerCallingTool("danger");
      let executed = false;
      const result = await runToolLoop({
        provider,
        providerCfg: {},
        model: "m",
        messages: [{ role: "user", content: "test" }],
        tools: [toolDef],
        maxIterations: 4,
        approveTool: async () => false,
        approvalMode: "plan",
        getToolDefinition: () => ({
          name: "danger",
          description: "d",
          parameters: { type: "object", properties: {} },
          riskLevel: "safe",
        }),
        executeTool: async () => {
          executed = true;
          return { ok: true };
        },
      });
      expect(executed).toBe(true);
      expect(result.text).toBe("done");
    });

    it('"auto" now requires approval for a "moderate" riskLevel tool (bugfix)', async () => {
      const provider = providerCallingTool("danger");
      let asked = false;
      const result = await runToolLoop({
        provider,
        providerCfg: {},
        model: "m",
        messages: [{ role: "user", content: "test" }],
        tools: [toolDef],
        maxIterations: 4,
        approveTool: async () => {
          asked = true;
          return true;
        },
        getToolDefinition: () => ({
          name: "danger",
          description: "d",
          parameters: { type: "object", properties: {} },
          riskLevel: "moderate",
        }),
        executeTool: async () => ({ ok: true }),
      });
      expect(asked).toBe(true);
      expect(result.text).toBe("done");
    });
  });
});

describe("withoutImageBytes", () => {
  it("drops image pixels from user parts but keeps the text naming the file", async () => {
    const { withoutImageBytes } = await import("./tool-loop.js");
    const out = withoutImageBytes([
      { role: "user", content: "hola" },
      {
        role: "user",
        content: [
          { type: "text", text: "Tool read_document returned an image (assistant/foto.jpg). Describe what you see." },
          { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } },
        ],
      },
      { role: "tool", content: "[Image loaded: assistant/foto.jpg]", tool_call_id: "c1" },
    ]);
    expect(out[0]).toEqual({ role: "user", content: "hola" });
    expect(out[1]!.content).toEqual([
      { type: "text", text: "Tool read_document returned an image (assistant/foto.jpg). Describe what you see." },
    ]);
    expect(JSON.stringify(out)).not.toContain("base64");
    expect(out[2]!.role).toBe("tool");
  });

  it("leaves a placeholder when an image part was the only content", async () => {
    const { withoutImageBytes } = await import("./tool-loop.js");
    const out = withoutImageBytes([{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] }]);
    expect(out[0]!.content).toEqual([{ type: "text", text: "[image omitted from history]" }]);
  });
});
