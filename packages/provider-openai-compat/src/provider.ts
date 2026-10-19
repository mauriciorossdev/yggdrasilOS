import { resolveProviderConfig, type YggdrasilConfig } from "@yggdrasil/config";
import {
  definePlugin,
  type ChatCompleteParams,
  type ChatCompleteResult,
  type ProviderCatalogContext,
  type ProviderModel,
  type ProviderPlugin,
} from "@yggdrasil/sdk";
import { chatComplete as clientChatComplete, chatCompleteStream as clientChatCompleteStream } from "./client.js";

export const OPENAI_COMPAT_PROVIDER_ID = "openai-compat";
export const PROVIDER_PLUGIN_ID = "provider-openai-compat";

const DEFAULT_MODELS: ProviderModel[] = [
  { id: "gpt-4o-mini", label: "GPT-4o Mini", provider: OPENAI_COMPAT_PROVIDER_ID, contextWindow: 128000 },
  { id: "gpt-4o", label: "GPT-4o", provider: OPENAI_COMPAT_PROVIDER_ID, contextWindow: 128000 },
  { id: "gpt-oss:120b", label: "GPT-OSS 120B (Ollama Cloud)", provider: OPENAI_COMPAT_PROVIDER_ID, contextWindow: 131072 },
  { id: "llama3", label: "Llama 3", provider: OPENAI_COMPAT_PROVIDER_ID, contextWindow: 8192 },
];

export type OpenAICompatResolvedConfig = {
  baseUrl?: string;
  apiKey?: string;
  defaultModel?: string;
  contextWindow?: number;
};

function resolveApiKeyFromEnv(): string | undefined {
  return (
    process.env.OLLAMA_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    process.env.YGGDRASIL_OPENAI_API_KEY?.trim() ||
    undefined
  );
}

export function resolveOpenAICompatConfig(
  globalConfig: YggdrasilConfig | undefined,
  ctx?: ProviderCatalogContext,
): OpenAICompatResolvedConfig {
  const fromGlobal = globalConfig
    ? resolveProviderConfig(globalConfig, OPENAI_COMPAT_PROVIDER_ID, PROVIDER_PLUGIN_ID)
    : {};
  const fromCtx = (ctx?.config ?? {}) as OpenAICompatResolvedConfig;
  return { ...fromGlobal, ...fromCtx };
}

export function createOpenAICompatProvider(options?: {
  globalConfig?: YggdrasilConfig;
}): ProviderPlugin {
  return {
    id: OPENAI_COMPAT_PROVIDER_ID,
    label: "OpenAI Compatible",

    async listModels(ctx) {
      const cfg = resolveOpenAICompatConfig(options?.globalConfig, ctx);
      const defaultModel = cfg.defaultModel;
      if (defaultModel && !DEFAULT_MODELS.some((m) => m.id === defaultModel)) {
        return [
          {
            id: defaultModel,
            label: defaultModel,
            provider: OPENAI_COMPAT_PROVIDER_ID,
            contextWindow: cfg.contextWindow,
          },
          ...DEFAULT_MODELS,
        ];
      }
      return DEFAULT_MODELS;
    },

    async resolveApiKey(ctx) {
      const cfg = resolveOpenAICompatConfig(options?.globalConfig, ctx);
      return cfg.apiKey ?? resolveApiKeyFromEnv();
    },

    async chatComplete(ctx, params: ChatCompleteParams): Promise<ChatCompleteResult> {
      const cfg = resolveOpenAICompatConfig(options?.globalConfig, ctx);
      const baseUrl = cfg.baseUrl ?? "https://api.openai.com/v1";
      const apiKey = cfg.apiKey ?? resolveApiKeyFromEnv();

      return clientChatComplete({ baseUrl, apiKey }, params);
    },

    async chatCompleteStream(ctx, params, onEvent) {
      const cfg = resolveOpenAICompatConfig(options?.globalConfig, ctx);
      const baseUrl = cfg.baseUrl ?? "https://api.openai.com/v1";
      const apiKey = cfg.apiKey ?? resolveApiKeyFromEnv();

      return clientChatCompleteStream({ baseUrl, apiKey }, params, onEvent);
    },
  };
}

export const openaiCompatPlugin = definePlugin({
  id: PROVIDER_PLUGIN_ID,
  name: "OpenAI Compatible Provider",
  version: "0.1.0",
  register(api) {
    const globalConfig = api.globalConfig as YggdrasilConfig;
    const provider = createOpenAICompatProvider({ globalConfig });
    api.registerProvider(provider);
  },
});

export default openaiCompatPlugin;
