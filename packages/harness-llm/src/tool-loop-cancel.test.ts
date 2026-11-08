import { describe, expect, it } from "vitest";
import type { ChatCompleteResult, ProviderPlugin } from "@yggdrasil/sdk";
import { runToolLoop, type ToolLoopOptions } from "./tool-loop.js";

const TOOL = {
  type: "function" as const,
  function: { name: "echo", description: "echo", parameters: { type: "object" as const, properties: {} } },
};

function baseOptions(provider: ProviderPlugin, over: Partial<ToolLoopOptions> = {}): ToolLoopOptions {
  return {
    provider,
    providerCfg: {},
    model: "m",
    sessionKey: "s",
    messages: [{ role: "user", content: "go" }],
    tools: [TOOL],
    maxIterations: 4,
    executeTool: async () => ({ ok: true }),
    ...over,
  };
}

const toolCallResult: ChatCompleteResult = {
  text: "",
  model: "m",
  finishReason: "tool_calls",
  toolCalls: [{ id: "c1", name: "echo", arguments: "{}" }],
};

describe("runToolLoop cancellation", () => {
  it("returns cancelled without calling the model when already aborted", async () => {
    let calls = 0;
    const provider: ProviderPlugin = {
      id: "p",
      label: "P",
      listModels: () => [],
      chatComplete: async () => {
        calls += 1;
        return { text: "x", model: "m", finishReason: "stop" };
      },
    };
    const controller = new AbortController();
    controller.abort();
    const result = await runToolLoop(baseOptions(provider, { signal: controller.signal }));
    expect(result.classification).toBe("cancelled");
    expect(result.text).toBe("(cancelled)");
    expect(calls).toBe(0);
  });

  it("stops waiting on a provider that never answers", async () => {
    const provider: ProviderPlugin = {
      id: "p",
      label: "P",
      listModels: () => [],
      chatComplete: () => new Promise(() => {}),
    };
    const controller = new AbortController();
    const pending = runToolLoop(baseOptions(provider, { signal: controller.signal, streaming: false }));
    setTimeout(() => controller.abort(), 10);
    const result = await pending;
    expect(result.classification).toBe("cancelled");
  });

  it("keeps the text streamed before the cancel and drops later deltas", async () => {
    const controller = new AbortController();
    const shown: string[] = [];
    const provider: ProviderPlugin = {
      id: "p",
      label: "P",
      listModels: () => [],
      chatComplete: async () => ({ text: "", model: "m", finishReason: "stop" }),
      chatCompleteStream: (_ctx, _params, onEvent) =>
        new Promise((resolve) => {
          onEvent({ type: "delta", text: "partial answer" });
          setTimeout(() => {
            controller.abort();
            onEvent({ type: "delta", text: " AFTER" });
            resolve({ text: "partial answer AFTER", model: "m", finishReason: "stop" });
          }, 5);
        }),
    };
    const result = await runToolLoop(baseOptions(provider, { signal: controller.signal, onDelta: (t) => shown.push(t) }));
    expect(result.classification).toBe("cancelled");
    expect(result.text).toBe("partial answer\n\n(cancelled)");
    expect(shown).toEqual(["partial answer"]);
  });

  it("does not store tool calls it never ran", async () => {
    const controller = new AbortController();
    const provider: ProviderPlugin = {
      id: "p",
      label: "P",
      listModels: () => [],
      chatComplete: async () => {
        controller.abort();
        return toolCallResult;
      },
    };
    let executed = 0;
    const result = await runToolLoop(
      baseOptions(provider, {
        signal: controller.signal,
        streaming: false,
        executeTool: async () => {
          executed += 1;
          return {};
        },
      }),
    );
    expect(result.classification).toBe("cancelled");
    expect(executed).toBe(0);
    expect(result.sessionAppend).toEqual([]);
  });

  it("treats cancelling during an approval prompt as a denial", async () => {
    const controller = new AbortController();
    let call = 0;
    const provider: ProviderPlugin = {
      id: "p",
      label: "P",
      listModels: () => [],
      chatComplete: async () => {
        call += 1;
        return call === 1 ? toolCallResult : { text: "done", model: "m", finishReason: "stop" };
      },
    };
    let executed = 0;
    const result = await runToolLoop(
      baseOptions(provider, {
        signal: controller.signal,
        streaming: false,
        approvalMode: "restrict",
        approveTool: () => {
          setTimeout(() => controller.abort(), 5);
          return new Promise(() => {}); // user never answers
        },
        executeTool: async () => {
          executed += 1;
          return {};
        },
      }),
    );
    expect(executed).toBe(0);
    expect(result.classification).toBe("cancelled");
  });
});
