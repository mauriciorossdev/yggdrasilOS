import type { YggdrasilPlugin, ProviderPlugin } from "@yggdrasil/sdk";

export function createStreamProviderPlugin(id = "stream-test"): YggdrasilPlugin {
  return {
    id: `${id}-provider-plugin`,
    register(api) {
      api.registerProvider({
        id,
        label: "Stream Test",
        listModels: () => [{ id: "m1", label: "M1", provider: id }],
        chatComplete: async () => ({ text: "full", model: "m1" }),
        chatCompleteStream: async (_ctx, _params, onEvent) => {
          onEvent({ type: "delta", text: "part" });
          const result = { text: "partial done", model: "m1", finishReason: "stop" as const };
          onEvent({ type: "done", result });
          return result;
        },
      });
    },
  };
}

export function createToolLoopProviderPlugin(
  id = "tool-loop-test",
  options?: { toolName?: string },
): YggdrasilPlugin {
  const toolName = options?.toolName ?? "echo";
  let call = 0;

  return {
    id: `${id}-provider-plugin`,
    register(api) {
      const provider: ProviderPlugin = {
        id,
        label: "Tool Loop Test",
        listModels: () => [{ id: "m1", label: "M1", provider: id }],
        chatComplete: async () => {
          call += 1;
          if (call === 1) {
            return {
              text: "",
              model: "m1",
              finishReason: "tool_calls",
              toolCalls: [
                {
                  id: "c1",
                  name: toolName,
                  arguments: JSON.stringify({ message: "hi-tool" }),
                },
              ],
            };
          }
          return { text: "done after tool", model: "m1", finishReason: "stop" };
        },
      };
      api.registerProvider(provider);
    },
  };
}

export function createCapturingProviderPlugin(
  id = "capture-test",
): YggdrasilPlugin & { getLastMessages: () => unknown[] } {
  let lastMessages: unknown[] = [];
  const plugin: YggdrasilPlugin & { getLastMessages: () => unknown[] } = {
    id: `${id}-provider-plugin`,
    getLastMessages: () => lastMessages,
    register(api) {
      api.registerProvider({
        id,
        label: "Capture Test",
        listModels: () => [{ id: "m1", label: "M1", provider: id }],
        chatComplete: async (_ctx, params) => {
          lastMessages = params.messages;
          return { text: "captured", model: "m1", finishReason: "stop" };
        },
      });
    },
  };
  return plugin;
}
