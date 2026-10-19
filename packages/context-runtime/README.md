# @yggdrasil/context-runtime

## Purpose

The orchestration engine that turns a list of registered `ContextProvider`s into the actual
`system`-role messages spliced into a conversation. Given a set of provider IDs, it looks the
providers up in the kernel's global registry, runs each `assemble()` with a timeout and per-provider
error isolation, caches results in an in-memory TTL cache, sorts the resulting blocks by priority,
trims them to fit a token budget, and returns plain `ChatMessage[]`.

This is the composition layer the initial hypothesis expected — it does not implement any context
source itself, it only calls providers that were registered elsewhere (by `context-memory-db`,
`context-memory-local`, `context-project`, `context-prompt-files`, or any other plugin that calls
`registerContextProvider`).

## Public API

`packages/context-runtime/src/index.ts` re-exports:

- `resolveContext(ctx: ContextProviderContext, providerIds: string[], tokenBudget?: number):
  Promise<ChatMessage[]>` (`src/resolve.ts`) — the main entry point. Behavior, verified against
  `src/resolve.test.ts`:
  - If `providerIds` is empty, returns `[]` without touching the registry.
  - Looks up all providers via `listContextProviders()` from `@yggdrasil/kernel`, filtered to the
    given `providerIds`.
  - Per provider: checks the cache (`getContextCache()`) under key `` `${provider.id}:${ctx.agentId}:${ctx.sessionKey}` ``;
    on miss, calls `provider.supports?.(ctx)` (skips the provider if it returns `false`), then races
    `provider.assemble(ctx)` against a **hardcoded 2000ms timeout** (`PROVIDER_TIMEOUT_MS`). A
    timeout or thrown error is swallowed (logged via `console.warn`) and treated as an empty
    result — one bad provider never fails the whole turn.
  - Caches the result if the first block's `cacheable !== false`, using `ttlMs` from the first
    block or a default of 300_000ms (`DEFAULT_TTL_MS`).
  - Concatenates all provider results, sorts by `priority` ascending (lower number = appears
    earlier in the output), then greedily accepts blocks until adding one would exceed
    `tokenBudget` (token size = `block.tokens` if set, else `Math.ceil(content.length / 4)`).
  - Maps the trimmed blocks to `{ role, content }` (drops `source`/`priority`/`tokens`/etc — callers
    only get back plain chat messages).
- `ContextCache` (`src/cache.ts`) — a `Map`-backed TTL cache: `get(key)`, `set(key, blocks, ttlMs)`,
  `invalidate(providerId)` (deletes all keys prefixed `` `${providerId}:` ``), `clear()`.
- `getContextCache()` — process-wide singleton accessor (module-level `let globalCache`).
- `resetContextCacheForTest()` — nulls the singleton; used in tests, not meant for production code.

## Depends on

- `@yggdrasil/context-sdk` — `ContextBlock`, `ContextProviderContext` types.
- `@yggdrasil/kernel` — `listContextProviders()` (reads the same global registry that
  `registerContextProvider` writes to).
- `@yggdrasil/sdk` — `ChatMessage` type for the return value.

## Used by

Exactly one call site in the repo: `packages/pipeline/src/turn-kernel.ts`, inside the per-turn
request handling. It builds the `ContextProviderContext`, calls `resolveContext(...)`, and prepends
the result to conversation history before invoking the harness.

## Configuration

Not read directly by this package — `resolveContext` takes `providerIds` and `tokenBudget` as plain
arguments. The caller (`turn-kernel.ts`) sources them from `YggdrasilConfig`:

- `agent.contextProviders` (per-agent override) falls back to `config.context.defaultProviders`
  (`packages/config/src/index.ts`) — the list of provider IDs to resolve for a turn.
- `config.context.tokenBudget` — passed straight through as `tokenBudget`.

**Verified quirk in the caller worth knowing about:** `turn-kernel.ts` builds the shared
`ContextProviderContext.config` field as `config.pluginConfig?.[providerIds[0]]` — i.e. every
provider in the batch receives the *same* `ctx.config`, sourced from the config of only the
**first** provider ID in the list, and that lookup uses the context-provider ID (e.g.
`"memory-db"`), not the plugin ID (`"context-memory-db"`) that `pluginConfig` is keyed by
everywhere else in the repo (see `resolveProviderConfig` in `packages/config/src/index.ts` and the
`bundledPlugins`/discovered-plugin loading in `packages/kernel/src/plugin-loader.ts`, both of which
key `pluginConfig` by plugin ID). Practical effect: per-provider config like `context-memory-db`'s
`dbPath` or `context-prompt-files`' `paths` generally will not reach `assemble()` through this path
unless the provider happens to be first in `providerIds` and the config happens to be keyed under
the provider ID rather than the plugin ID. This is a real gap, not a documented feature — fix it in
`turn-kernel.ts` (build a per-provider config map) if per-provider configuration needs to work.

## Extending / what's safe to change

- `PROVIDER_TIMEOUT_MS` (2000) and `DEFAULT_TTL_MS` (300_000) in `src/resolve.ts` are the two
  tunables; there's no config plumbing for them today, so changing behavior means editing the
  constants.
- Adding a new context source requires no changes here — register a `ContextProvider` via
  `api.registerContextProvider(...)` from any plugin and add its `id` to
  `config.context.defaultProviders` or an agent's `contextProviders`.
- The cache is process-global and keyed only by `providerId:agentId:sessionKey` with no
  workspace/tenant dimension — fine for a single-workspace process, but would silently mix state if
  one process ever served multiple workspace roots.
- `resetContextCacheForTest` / `resetRegistryForTest` (from `@yggdrasil/kernel`) exist purely for
  test isolation; don't call them from application code.
