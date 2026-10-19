import { resolveProviderConfig, type YggdrasilConfig } from "@yggdrasil/config";
import {
  definePlugin,
  type ChatCompleteParams,
  type ChatCompleteResult,
  type ProviderCatalogContext,
  type ProviderModel,
  type ProviderPlugin,
} from "@yggdrasil/sdk";
import {
  chatComplete as clientChatComplete,
  chatCompleteStream as clientChatCompleteStream,
  listModels as clientListModels,
} from "./client.js";

export const OLLAMA_PROVIDER_ID = "ollama";
export const OLLAMA_PLUGIN_ID = "provider-ollama";

const DEFAULT_BASE_URL = "http://127.0.0.1:11434";

export type OllamaResolvedConfig = {
  baseUrl?: string;
  defaultModel?: string;
  contextWindow?: number;
};

function resolveOllamaConfig(
  globalConfig: YggdrasilConfig | undefined,
  ctx?: ProviderCatalogContext,
): OllamaResolvedConfig {
  const fromGlobal = globalConfig
    ? resolveProviderConfig(globalConfig, OLLAMA_PROVIDER_ID, OLLAMA_PLUGIN_ID)
    : {};
  const fromCtx = (ctx?.config ?? {}) as OllamaResolvedConfig;
  return { ...fromGlobal, ...fromCtx };
}

export function createOllamaProvider(options?: {
  globalConfig?: YggdrasilConfig;
}): ProviderPlugin {
  return {
    id: OLLAMA_PROVIDER_ID,
    label: "Ollama (Native)",

    async listModels(ctx) {
      const cfg = resolveOllamaConfig(options?.globalConfig, ctx);
      const baseUrl = cfg.baseUrl ?? DEFAULT_BASE_URL;
      // Deliberately does NOT swallow a failure into a fake fallback model
      // anymore — silently substituting a made-up "llama3.2" entry when the
      // host is unreachable just hid the real problem behind what looked
      // like a normal, working model list. Let it throw; the gateway's
      // providers.list handler catches this per-provider and surfaces it as
      // a real "unreachable" warning instead.
      const tags = await clientListModels({ baseUrl });
      return tags.models.map((m): ProviderModel => ({
        id: m.name,
        label: m.name,
        provider: OLLAMA_PROVIDER_ID,
        contextWindow: cfg.contextWindow,
      }));
    },

    async resolveApiKey() {
      return "local";
    },

    async chatComplete(ctx, params: ChatCompleteParams): Promise<ChatCompleteResult> {
      const cfg = resolveOllamaConfig(options?.globalConfig, ctx);
      const baseUrl = cfg.baseUrl ?? DEFAULT_BASE_URL;
      return clientChatComplete({ baseUrl }, params);
    },

    async chatCompleteStream(ctx, params, onEvent) {
      const cfg = resolveOllamaConfig(options?.globalConfig, ctx);
      const baseUrl = cfg.baseUrl ?? DEFAULT_BASE_URL;
      return clientChatCompleteStream({ baseUrl }, params, onEvent);
    },
  };
}

export const ollamaPlugin = definePlugin({
  id: OLLAMA_PLUGIN_ID,
  name: "Ollama Native Provider",
  version: "0.1.0",
  register(api) {
    const globalConfig = api.globalConfig as YggdrasilConfig;
    const provider = createOllamaProvider({ globalConfig });
    api.registerProvider(provider);
  },
});

export default ollamaPlugin;
