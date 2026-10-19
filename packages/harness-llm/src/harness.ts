import {
  isToolAllowedForAgent,
  resolveAgent,
  resolveProviderConfig,
  type AgentConfig,
  type YggdrasilConfig,
} from "@yggdrasil/config";
import { getProvider } from "@yggdrasil/kernel";
import { OPENAI_COMPAT_PROVIDER_ID } from "@yggdrasil/provider-openai-compat";
import { executeTool, resolveTools, toolsToOpenAI, getTool } from "@yggdrasil/tools-runtime";
import {
  definePlugin,
  type AgentHarness,
  type HarnessAttemptParams,
  type HarnessAttemptResult,
  type HarnessSupportContext,
} from "@yggdrasil/sdk";
import { runToolLoop } from "./tool-loop.js";

export const LLM_HARNESS_ID = "llm";

export function createLlmHarness(options?: { config?: YggdrasilConfig }): AgentHarness {
  return {
    id: LLM_HARNESS_ID,
    label: "LLM Harness",

    supports(ctx: HarnessSupportContext) {
      if (ctx.provider === "builtin") {
        return { supported: false, reason: "builtin provider uses echo harness" };
      }
      const provider = getProvider(ctx.provider);
      if (!provider?.chatComplete) {
        return { supported: false, reason: `provider "${ctx.provider}" not found or has no chatComplete` };
      }
      return { supported: true, priority: 100 };
    },

    async runAttempt(params: HarnessAttemptParams): Promise<HarnessAttemptResult> {
      const provider = getProvider(params.provider);
      if (!provider?.chatComplete) {
        return {
          text: `No provider registered for "${params.provider}"`,
          classification: "fallback",
        };
      }

      const config = options?.config;
      const providerCfg = config ? resolveProviderConfig(config, params.provider) : {};
      const defaultModel =
        (providerCfg.defaultModel as string | undefined) ??
        (params.provider === OPENAI_COMPAT_PROVIDER_ID ? "gpt-4o-mini" : "default");

      try {
        const apiKey = await provider.resolveApiKey?.({ config: providerCfg });
        if (!apiKey && params.provider === OPENAI_COMPAT_PROVIDER_ID) {
          return {
            text: "LLM unavailable: set OLLAMA_API_KEY, OPENAI_API_KEY, or providers.openai-compat.apiKey",
            classification: "fallback",
          };
        }

        const messages = [
          ...(params.history ?? []),
          { role: "user" as const, content: params.message },
        ];

        const toolCtx = {
          sessionKey: params.sessionKey,
          config: config ?? {},
          workspaceRoot: params.workspaceRoot,
          metadata: params.metadata,
          events: params.events,
        };
        // Per-agent tool allowlist (AgentConfig.tools.allow): filters what the
        // model is shown, and executeTool below refuses anything outside it
        // in case the model asks for a tool by name anyway.
        const agent: AgentConfig = config
          ? resolveAgent(config, params.metadata?.agentId as string | undefined)
          : { id: "default" };
        const agentTools = (await resolveTools(toolCtx)).filter((t) =>
          isToolAllowedForAgent(agent, t.name),
        );
        const tools = toolsToOpenAI(agentTools);
        const maxIterations = config?.harness?.maxToolIterations ?? 8;
        const streaming = config?.harness?.streaming !== false;

        const parallelToolCalls = config?.harness?.parallelToolCalls !== false;

        const loopResult = await runToolLoop({
          provider,
          providerCfg,
          model: params.modelId ?? defaultModel,
          sessionKey: params.sessionKey,
          messages,
          tools,
          maxIterations,
          streaming,
          parallelToolCalls,
          onDelta: params.onDelta,
          executeTool: (name, args) => {
            if (!isToolAllowedForAgent(agent, name)) {
              throw new Error(`Tool "${name}" is not allowed for agent "${agent.id}"`);
            }
            return executeTool(name, args, toolCtx);
          },
          approveTool: params.approveTool,
          approvalMode: params.approvalMode,
          getToolDefinition: (name) => getTool(name),
          // Every tool call goes through here regardless of where it's
          // actually implemented — a server-side tool and a device tool
          // (gateway's tools-runtime device-tool provider hook) both end up
          // calling executeTool() the same way, so this one emit covers
          // both instead of needing a separate one in the device-tools
          // invoke/result flow.
          onToolExecute: (event) => {
            void params.events?.emit("tool.execute", {
              sessionKey: params.sessionKey,
              toolName: event.name,
              status: event.ok ? "ok" : "error",
              args: event.args,
              result: event.result,
              error: event.error,
              image: event.image,
            });
          },
        });

        return {
          ...loopResult,
          metadata: {
            ...loopResult.metadata,
            harnessId: LLM_HARNESS_ID,
            model: params.modelId ?? defaultModel,
          },
        };
      } catch (err) {
        return {
          text: err instanceof Error ? err.message : String(err),
          classification: "error",
        };
      }
    },
  };
}

export const llmHarnessPlugin = definePlugin({
  id: "harness-llm",
  name: "LLM Harness",
  version: "0.1.0",
  register(api) {
    api.registerHarness(createLlmHarness({ config: api.globalConfig as YggdrasilConfig }));
  },
});

export default llmHarnessPlugin;
