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

export const ANTHROPIC_PROVIDER_ID = "anthropic";
export const PROVIDER_PLUGIN_ID = "provider-anthropic";
export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_BASE_URL = "https://api.anthropic.com";

const DEFAULT_MODELS: ProviderModel[] = [
  {
    id: DEFAULT_ANTHROPIC_MODEL,
    label: "Claude Haiku 4.5",
    provider: ANTHROPIC_PROVIDER_ID,
    contextWindow: 200000,
    supportsTools: true,
  },
];

export type AnthropicResolvedConfig = {
  baseUrl?: string;
  apiKey?: string;
  defaultModel?: string;
  contextWindow?: number;
};

function resolveApiKeyFromEnv(): string | undefined {
  return (
    process.env.ANTHROPIC_API_KEY?.trim() ||
    process.env.YGGDRASIL_ANTHROPIC_API_KEY?.trim() ||
    undefined
  );
}

export function resolveAnthropicConfig(
  globalConfig: YggdrasilConfig | undefined,
  ctx?: ProviderCatalogContext,
): AnthropicResolvedConfig {
  const fromGlobal = globalConfig
    ? resolveProviderConfig(globalConfig, ANTHROPIC_PROVIDER_ID, PROVIDER_PLUGIN_ID)
    : {};
  const fromCtx = (ctx?.config ?? {}) as AnthropicResolvedConfig;
  return { ...fromGlobal, ...fromCtx };
}

export function createAnthropicProvider(options?: {
  globalConfig?: YggdrasilConfig;
}): ProviderPlugin {
  const clientOptions = (ctx: ProviderCatalogContext) => {
    const cfg = resolveAnthropicConfig(options?.globalConfig, ctx);
    return {
      baseUrl: cfg.baseUrl ?? DEFAULT_BASE_URL,
      apiKey: cfg.apiKey ?? resolveApiKeyFromEnv(),
    };
  };

  return {
    id: ANTHROPIC_PROVIDER_ID,
    label: "Anthropic",

    async listModels(ctx) {
      const cfg = resolveAnthropicConfig(options?.globalConfig, ctx);
      const defaultModel = cfg.defaultModel;
      if (defaultModel && !DEFAULT_MODELS.some((m) => m.id === defaultModel)) {
        return [
          {
            id: defaultModel,
            label: defaultModel,
            provider: ANTHROPIC_PROVIDER_ID,
            contextWindow: cfg.contextWindow,
            supportsTools: true,
          },
          ...DEFAULT_MODELS,
        ];
      }
      return DEFAULT_MODELS;
    },

    async resolveApiKey(ctx) {
      const cfg = resolveAnthropicConfig(options?.globalConfig, ctx);
      return cfg.apiKey ?? resolveApiKeyFromEnv();
    },

    async chatComplete(ctx, params: ChatCompleteParams): Promise<ChatCompleteResult> {
      return clientChatComplete(clientOptions(ctx), params);
    },

    async chatCompleteStream(ctx, params, onEvent) {
      return clientChatCompleteStream(clientOptions(ctx), params, onEvent);
    },
  };
}

export const anthropicPlugin = definePlugin({
  id: PROVIDER_PLUGIN_ID,
  name: "Anthropic Provider",
  version: "0.1.0",
  register(api) {
    const globalConfig = api.globalConfig as YggdrasilConfig;
    api.registerProvider(createAnthropicProvider({ globalConfig }));
  },
});

export default anthropicPlugin;
