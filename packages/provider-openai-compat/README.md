# @yggdrasil/provider-openai-compat

## Purpose

`ProviderPlugin` implementation for any backend that speaks the OpenAI chat-completions wire format at `POST {baseUrl}/chat/completions` — OpenAI itself, Ollama Cloud's OpenAI-compatible endpoint, or any other OpenAI-shaped host. This is the provider used when an agent's config sets `"provider": "openai-compat"` (see `agents[].provider` in `yggdrasil.config.json`), and it's the default provider baked into `DEFAULT_CONFIG` in `@yggdrasil/config` (`providers["openai-compat"]` pointing at `https://api.openai.com/v1`).

Distinct from `provider-ollama`, which talks to Ollama's *native* `/api/chat` endpoint. Use this package for a single code path across OpenAI-shaped backends; use `provider-ollama` when you specifically want Ollama's native tool-calling/model-listing behavior (see that package's README for the tradeoffs).

## Public API

From `src/index.ts`:

- `createOpenAICompatProvider(options?: { globalConfig?: YggdrasilConfig }): ProviderPlugin` (`src/provider.ts`) — builds the provider object (`id: "openai-compat"`) with `listModels`, `resolveApiKey`, `chatComplete`, `chatCompleteStream`.
- `openaiCompatPlugin` (default export too) — a `definePlugin(...)`-wrapped plugin (`id: "provider-openai-compat"`) whose `register(api)` calls `api.registerProvider(createOpenAICompatProvider({ globalConfig: api.globalConfig }))`. This is what the plugin loader loads via `yggdrasil.plugin.json` → `entry: "./dist/index.js"`.
- `OPENAI_COMPAT_PROVIDER_ID = "openai-compat"` — used elsewhere to look this provider up by ID (`getProvider("openai-compat")` in `@yggdrasil/kernel`) and to special-case default-model/error-message behavior in `@yggdrasil/harness-llm`.
- `PROVIDER_PLUGIN_ID = "provider-openai-compat"` — the plugin ID, used as the `ownerPluginId` argument to `resolveProviderConfig` so plugin-scoped config (`pluginConfig["provider-openai-compat"]`) also applies.
- `resolveOpenAICompatConfig(globalConfig, ctx?): OpenAICompatResolvedConfig` — merges `providers["openai-compat"]` from `YggdrasilConfig` with whatever `ProviderCatalogContext.config` the caller passed in (context wins). Exported so callers/tests can inspect the merged config without going through a full provider call.
- `chatComplete` / `chatCompleteStream` (`src/client.ts`) — the low-level HTTP client, re-exported directly. Takes `OpenAICompatClientOptions` (`{ baseUrl, apiKey?, fetchImpl? }`) plus `ChatCompleteParams`; `fetchImpl` exists purely so tests can inject a mock `fetch`.
- `OpenAICompatClientOptions` type.

## Depends on

- `@yggdrasil/config` — `resolveProviderConfig` to read `providers["openai-compat"].*` (and `pluginConfig["openai-compat"]` / `pluginConfig["provider-openai-compat"]`) out of `YggdrasilConfig`.
- `@yggdrasil/sdk` — `definePlugin`, and the `ChatCompleteParams`/`ChatCompleteResult`/`ProviderCatalogContext`/`ProviderModel`/`ProviderPlugin` types every provider implements.

## Used by

- `@yggdrasil/harness-llm` (`src/harness.ts`) — imports `OPENAI_COMPAT_PROVIDER_ID` (not the provider object itself) to: (a) pick `"gpt-4o-mini"` as the default model when the resolved provider is `openai-compat` and no `defaultModel` is configured, and (b) return a specific "set OLLAMA_API_KEY, OPENAI_API_KEY, or providers.openai-compat.apiKey" fallback message when this provider has no resolvable API key.
- `@yggdrasil/pipeline` (`src/turn-kernel.ts`) — same pattern: imports `OPENAI_COMPAT_PROVIDER_ID` as the default `providerId` fallback (`agent.provider ?? OPENAI_COMPAT_PROVIDER_ID`) when building the session-compaction summarizer function.

Also discoverable at runtime through the plugin system (`plugins.discoverNodeModules` in `yggdrasil.config.json`, scanning `node_modules/@yggdrasil/*` for `yggdrasil.plugin.json`), independent of the static imports above — that's how the provider actually gets registered into `@yggdrasil/kernel`'s registry (`getProvider("openai-compat")`), which is what both callers above ultimately rely on at runtime.

## Configuration

Reads `providers["openai-compat"]` (merged with `pluginConfig["openai-compat"]` then `pluginConfig["provider-openai-compat"]`, later keys winning) from `yggdrasil.config.json`, via `resolveOpenAICompatConfig`:
- `baseUrl` — default `"https://api.openai.com/v1"` if unset. Point this at any OpenAI-compatible host (e.g. the repo's own example config uses `"https://ollama.com/v1"` for Ollama Cloud).
- `apiKey` — checked first; if unset, `resolveApiKeyFromEnv()` falls back to `OLLAMA_API_KEY`, then `OPENAI_API_KEY`, then `YGGDRASIL_OPENAI_API_KEY` (first non-empty env var wins).
- `defaultModel` — used by `listModels` to inject a synthetic entry ahead of `DEFAULT_MODELS` when it isn't already one of the built-ins, and read by `@yggdrasil/harness-llm` as the model to send if the caller didn't pick one.
- `contextWindow` — passed through onto the synthetic `defaultModel` entry in `listModels`; not enforced anywhere (no request truncation).

`DEFAULT_MODELS` (hardcoded in `provider.ts`) always includes `gpt-4o-mini`, `gpt-4o`, `gpt-oss:120b` (labeled "Ollama Cloud"), and `llama3` — this list is just what `listModels` reports for UI/catalog purposes; it doesn't restrict which model IDs `chatComplete` will actually send.

## Extending / what's safe to change

- **Pointing at a different OpenAI-compatible endpoint**: pure config change, no code needed — set `providers["openai-compat"].baseUrl` (and `.apiKey`, `.defaultModel`) in `yggdrasil.config.json`. Anything that answers `POST {baseUrl}/chat/completions` in the OpenAI request/response shape (including SSE streaming with `data: {...}` / `data: [DONE]` framing) works.
- **Adding a new auth mechanism** (e.g. a custom header instead of `Authorization: Bearer`): edit the two `fetchFn(...)` calls in `src/client.ts` (`chatComplete` and `chatCompleteStream`) — both currently hardcode `Authorization: Bearer ${apiKey}`. If it needs to be conditional per-host, thread an option through `OpenAICompatClientOptions` rather than branching on `baseUrl` string matching.
- **Adding a new env var fallback for the API key**: extend `resolveApiKeyFromEnv()` in `provider.ts` — it's a simple first-non-empty-wins chain (`OLLAMA_API_KEY` → `OPENAI_API_KEY` → `YGGDRASIL_OPENAI_API_KEY`).
- **Changing which models `listModels` reports**: edit `DEFAULT_MODELS` in `provider.ts`, or the injection logic that prepends `cfg.defaultModel` when it's not already in the list. This is cosmetic/catalog-only — it doesn't gate what `chatComplete`/`chatCompleteStream` will accept as `params.model`.
- **Streaming parser robustness**: `chatCompleteStream` in `client.ts` buffers partial lines across chunks and accumulates tool-call argument fragments by index (`toolCallsAcc: Map<number, ChatToolCall>`) before finalizing — if a new host's SSE framing differs (e.g. multi-event lines, different `[DONE]` sentinel), that parsing loop is the place to adapt, not `provider.ts`.
- **Empty-response guard**: `parseChatResponse` throws `"OpenAI-compatible provider returned empty response"` if a non-streaming response has neither `text` nor `toolCalls`. If a new backend legitimately returns empty content in some valid case, that guard needs loosening there specifically — it exists to catch malformed/error responses that still return HTTP 200.
