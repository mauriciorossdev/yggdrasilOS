# @yggdrasil/provider-ollama

## Purpose

`ProviderPlugin` implementation that talks to a local (or remote) [Ollama](https://ollama.com) server's native `/api/chat` and `/api/tags` endpoints. This is the provider used when an agent's config sets `"provider": "ollama"` (see `agents[].provider` in `yggdrasil.config.json`). It's the cheapest way to run yggdrasil fully offline against a locally-hosted model.

Distinct from `@yggdrasil/provider-openai-compat`, which can *also* reach Ollama (Ollama exposes an OpenAI-compatible `/v1` endpoint too — see the `providers.openai-compat.baseUrl: "https://ollama.com/v1"` example in the repo's config) but goes through the generic OpenAI wire format instead of Ollama's native one. Use this package when you want Ollama's native tool-calling / model listing behavior; use `provider-openai-compat` when you want a single code path across OpenAI-shaped backends (OpenAI itself, Ollama Cloud, any other OpenAI-compatible host).

## Public API

From `src/index.ts`:
- `createOllamaProvider(options?: { globalConfig?: YggdrasilConfig }): ProviderPlugin` — builds the provider object with `listModels`, `resolveApiKey`, `chatComplete`, `chatCompleteStream`.
- `ollamaPlugin` (default export too) — a `definePlugin(...)`-wrapped plugin that calls `api.registerProvider(createOllamaProvider(...))` on `register()`. This is what the plugin loader actually loads (`yggdrasil.plugin.json` → `entry: "./dist/index.js"`).
- `OLLAMA_PROVIDER_ID = "ollama"`, `OLLAMA_PLUGIN_ID = "provider-ollama"` — string IDs used elsewhere to look this provider up (e.g. `getProvider("ollama")` in `@yggdrasil/kernel`).
- `toOllamaMessages`, `toOllamaTools`, `fromOllamaToolCalls` — wire-format converters between yggdrasil's generic `ChatMessage`/`ChatToolDefinition`/`ChatToolCall` shapes (from `@yggdrasil/sdk`) and Ollama's `/api/chat` request/response shapes. Exported mainly for testing; not meant to be used directly by other packages.

Internals (not exported, `src/client.ts` + `src/messages.ts`):
- `chatComplete` / `chatCompleteStream` (`client.ts`) — POST to `{baseUrl}/api/chat` with `stream: false`/`true`. Streaming reads newline-delimited JSON chunks off the response body.
- `listModels` (`client.ts`) — GET `{baseUrl}/api/tags`; falls back to a single synthetic model entry (`cfg.defaultModel ?? "llama3.2"`) if the request fails (e.g. Ollama not running), so the app doesn't hard-crash when the daemon is down.
- `parseFallbackToolCalls` (`messages.ts`) — **defensive fallback** for weaker/quantized local models. Ollama is supposed to populate the structured `message.tool_calls` field when a model's chat template wraps a call in `<tool_call>...</tool_call>` tags, but small models (e.g. `qwen2.5-coder:7b`) sometimes emit the call as bare JSON content instead, without the tags, and Ollama then has nothing to parse — the raw JSON leaks into `message.content` and gets shown to the user verbatim. `parseFallbackToolCalls` detects `{"name":...,"arguments":...}` (tagged or bare) in the text content and recovers it as a real tool call so the loop still executes it. Wired into both `chatComplete` and `chatCompleteStream` in `client.ts`, gated behind `tools` being non-empty on the request (so it never misfires on ordinary prose). In the streaming path this requires buffering: the client can't know a chunk is a tool-call attempt until it sees the first non-whitespace character, so it holds back `onDelta` emission while content looks like it might be starting a tool call (`{` or `<`), and only flushes it as normal text if that guess turns out wrong.

## Depends on

- `@yggdrasil/config` — `resolveProviderConfig` to read `providers.ollama.*` out of `YggdrasilConfig` (`baseUrl`, `defaultModel`, `contextWindow`).
- `@yggdrasil/sdk` — `definePlugin`, and the `ChatCompleteParams`/`ChatCompleteResult`/`ProviderPlugin`/etc types every provider implements.

## Used by

Not statically imported by other packages — it's discovered at runtime through the plugin system (`plugins.discoverNodeModules` in `yggdrasil.config.json`, which scans `node_modules/@yggdrasil/*` for `yggdrasil.plugin.json` manifests, plus explicit `plugins.load.paths`). Anything that wants to talk to it goes through `@yggdrasil/kernel`'s provider registry by ID (`getProvider("ollama")`), notably `@yggdrasil/harness-llm`.

## Configuration

Reads `providers.ollama` from `yggdrasil.config.json` (see `resolveOllamaConfig` in `provider.ts`):
- `baseUrl` — default `http://127.0.0.1:11434`.
- `defaultModel` — used only as the `listModels` fallback label when the Ollama daemon can't be reached.
- `contextWindow` — passed through on `ProviderModel` entries, not enforced by this package.

`resolveApiKey()` always returns `"local"` — Ollama's native API doesn't require a key; this just satisfies the `ProviderPlugin` interface.

## Extending / what's safe to change

- **Pointing at a different host** (remote Ollama, Docker container, etc.): set `providers.ollama.baseUrl` in config — no code change needed.
- **New Ollama API fields** (e.g. additional sampling options): add them to the `body` object in `client.ts`'s `chatComplete`/`chatCompleteStream`, following the existing `params.temperature → body.options.temperature` pattern.
- **The fallback tool-call parser** is intentionally conservative (only triggers when `tools` were offered on the request, and for untagged content requires the *entire* trimmed response to parse as `{name, arguments}` — see `messages.test.ts` for the "ordinary prose" and "JSON-looking fragment in prose" cases it must NOT trigger on). If you see it mis-firing or missing a new model's malformed-tool-call shape, extend `parseFallbackToolCalls` / `tryParseToolCallJson` rather than loosening the gate in `client.ts`.
- If Ollama's native tool-calling still isn't reliable enough for a given model, the real fix is usually a different/larger model, not more parsing — see the note in `messages.ts` above `parseFallbackToolCalls`.
