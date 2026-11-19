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

type AnthropicModelsResponse = { data?: Array<{ id?: string; display_name?: string }> };

/**
 * Live model catalog (GET /v1/models). Throws on a rejected key / unreachable
 * host so Settings can show the failure; callers only invoke it with a key.
 */
export async function fetchAnthropicModels(
  opts: { baseUrl: string; apiKey: string; fetchImpl?: typeof fetch },
): Promise<ProviderModel[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(`${opts.baseUrl.replace(/\/+$/, "")}/v1/models?limit=100`, {
    headers: { "x-api-key": opts.apiKey, "anthropic-version": "2023-06-01" },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(`Anthropic rechazó la API key (HTTP ${res.status})`);
  }
  if (!res.ok) throw new Error(`Anthropic /v1/models respondió HTTP ${res.status}`);
  const body = (await res.json()) as AnthropicModelsResponse;
  return (body.data ?? [])
    .filter((m): m is { id: string; display_name?: string } => typeof m.id === "string")
    .map((m) => ({
      id: m.id,
      label: m.display_name || m.id,
      provider: ANTHROPIC_PROVIDER_ID,
      contextWindow: 200000,
      supportsTools: true,
    }));
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
      const apiKey = cfg.apiKey ?? resolveApiKeyFromEnv();
      if (apiKey) {
        // Offline, a proxy without /v1/models or a key that can't list models must not empty the picker:
        // chat still works, so fall back to the static list below.
        try {
          const live = await fetchAnthropicModels({ baseUrl: cfg.baseUrl ?? DEFAULT_BASE_URL, apiKey });
          if (live.length > 0) return live;
        } catch {
          /* fall through to the static list */
        }
      }
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
