# @yggdrasil/config

## Purpose

This package owns the shape of `yggdrasil.config.json` (the `YggdrasilConfig` type), its defaults, how
partial configs get merged, how the file is read/written on disk, how gateway/HTTP API-key auth is derived
from it, how a client-facing (secret-masked) view of it is produced, and how a runtime patch to it is
validated before being applied. It is the single source of truth every other package reads config through —
nothing else parses `yggdrasil.config.json` directly.

## Public API

`packages/config/src/index.ts` is the entry point; it defines the config types inline and re-exports
`auth.ts`, `file.ts`, `patch.ts`, `sanitize.ts`.

**index.ts**
- `YggdrasilConfig` — the full config shape: `agents`, `defaultAgent`, `harness` (policy/pinnedId/
  maxToolIterations/streaming/compactBeforeTurn/toolApproval/parallelToolCalls), `auth`, `plugins`
  (load.paths/discoverNodeModules/discoverAll/installed/disabled), `gateway` (port/host), `providers`,
  `sessions`, `channels`, `pluginConfig`, `context` (defaultProviders/tokenBudget).
- `AgentConfig`, `ProviderConfig`, `SessionsConfig`, `ToolApprovalPolicy` — sub-types of `YggdrasilConfig`.
- `DEFAULT_CONFIG` — the baked-in default (`gateway: {port: 18789, host: "127.0.0.1"}`, one default agent
  on `openai-compat`/`gpt-4o-mini`, `sessions.maxMessages: 50`, etc.) — what `readConfigFile` merges a
  partial user file onto.
- `mergeConfig(base, override?)` — deep-ish merge (shallow per top-level key, but merges nested objects
  like `harness`, `gateway`, `providers`, `sessions`, `plugins`, `pluginConfig`, `channels`, `auth`).
- `resolveAgent(config, agentId?)` — finds an `AgentConfig` by id (or `defaultAgent`), falling back to
  `{id, label: id}` if not found.
- `buildSessionKey(channelId, accountId, senderId)` — the canonical `"channelId:accountId:senderId"` key
  used everywhere a session needs to be addressed.
- `resolveProviderConfig(config, providerId, ownerPluginId?)` — merges `config.providers[providerId]` with
  `config.pluginConfig[providerId]` and (if given) `config.pluginConfig[ownerPluginId]`, later sources
  winning — this is how a provider plugin gets its `baseUrl`/`apiKey`/`defaultModel` plus any
  provider-specific extra keys.

**auth.ts**
- `AuthConfig` — `{ gateway?: {apiKey?, required?}, http?: {apiKey?} }`.
- `resolveGatewayApiKey(config)` — `config.auth.gateway.apiKey` falling back to `process.env.YGGDRASIL_API_KEY`.
- `resolveHttpApiKey(config, accountId?)` — `config.auth.http.apiKey`, then the shared gateway key/env var,
  then `config.channels.http.accounts[accountId].token`.
- `isGatewayAuthRequired(config)` / `isHttpAuthRequired(config, accountId?)` — whether auth should be enforced
  (explicit `required` flag, or implied by a key being configured at all).
- `validateApiKey(provided, expected)` — trimmed string comparison; `true` if no key is expected.
- `parseBearerToken(authorization)` — extracts the token from an `Authorization: Bearer …` header.

**file.ts**
- `CONFIG_FILENAME` = `"yggdrasil.config.json"`.
- `resolveConfigPath(workspaceRoot)` — joins workspace root + filename.
- `readConfigFile(workspaceRoot)` — reads and JSON-parses the file, merges onto `DEFAULT_CONFIG`; if the
  file is missing/unparseable, returns `{config: {...DEFAULT_CONFIG}, exists: false}` (never throws).
- `writeConfigFile(workspaceRoot, partial)` — reads current config, merges the partial in, writes it back
  pretty-printed.
- `uniqueStrings(values)` — trims, dedupes, drops empties from a string array (small utility used for plugin lists).

**patch.ts**
- `ConfigPatchInput` — `Pick<YggdrasilConfig, "agents"|"defaultAgent"|"harness"|"channels">`.
- `validateConfigPatch(input)` — whitelists exactly those four top-level keys (throws `forbidden keys: …`
  on anything else, e.g. `auth` or `providers`) and shape-checks each one. This is the guardrail between
  the gateway's `config.patch` RPC method and arbitrary client-supplied JSON — it exists specifically so a
  remote client cannot write secrets (`providers[x].apiKey`, `auth.*`) through the patch endpoint.

**sanitize.ts**
- `sanitizeConfigForClient(config)` — returns a copy of the config safe to send over the gateway RPC:
  masks `providers[x].apiKey`, `channels[x].accounts[y].token/botToken/apiKey`, and `auth.*.apiKey` to
  `"***"`; drops fields entirely that aren't meant to be exposed (e.g. `pluginConfig`, `context`).

## Depends on

- **`@yggdrasil/sdk`** is declared in `package.json` but **nothing in `packages/config/src` currently
  imports from it** — grepping the package finds no `@yggdrasil/sdk` import. Treat this as a stale/unused
  dependency unless you find a reason to keep it; don't assume config exposes any sdk-typed API.

## Used by

Almost every runtime package, since `YggdrasilConfig` is the parameter type threaded through the whole
system: `packages/kernel` (`lifecycle.ts`, `plugin-loader.ts` — reads `plugins.*`), `packages/pipeline`
(`turn-kernel.ts` — `resolveAgent`, `resolveProviderConfig`), `packages/gateway` (`server.ts`,
`methods.ts`, `channel-manager.ts`, `auth.ts` — `isGatewayAuthRequired`, `resolveGatewayApiKey`,
`validateApiKey`, `mergeConfig`, `readConfigFile`/`writeConfigFile`, `sanitizeConfigForClient`,
`validateConfigPatch`, `buildSessionKey`), `packages/harness-llm` and `packages/provider-ollama`/
`provider-openai-compat` (`resolveProviderConfig` to get `baseUrl`/`apiKey`), `packages/harness-runtime`
(`selection.ts`), `packages/sessions` (`compact.ts`, `store.ts`), `packages/cli` (`config-io.ts`,
`index.ts` — `mergeConfig`, orchestrates the whole bootstrap), `packages/channel-tui`/`channel-http` and
`extensions/channel-telegram`/`echo-channel` (`buildSessionKey`).

## Configuration

This package *is* the configuration schema — see `YggdrasilConfig` above. There's no separate config it
reads; `DEFAULT_CONFIG` in `index.ts` is the ground truth for defaults (gateway on `127.0.0.1:18789`,
default provider `openai-compat` pointed at `https://api.openai.com/v1`).

## Extending / what's safe to change

- **Adding a new top-level `YggdrasilConfig` key**: add the type in `index.ts`, add a sensible default to
  `DEFAULT_CONFIG` if it should have one, and add a merge rule to `mergeConfig` — a naive `{...base,
  ...override}` spread will *replace* nested objects wholesale instead of merging them, which is why
  `harness`, `gateway`, `providers`, `sessions`, `plugins`, `pluginConfig`, `channels`, `auth` each have an
  explicit merge line. Forgetting this means a partial override of e.g. `sessions.maxTokens` silently drops
  `sessions.maxMessages`.
- **If the new key holds secrets**, add masking for it in `sanitize.ts`'s `sanitizeConfigForClient` —
  anything not explicitly copied there is already dropped by default (it builds an allowlisted object), but
  if you add a field to an existing allowlisted subsection (`providers`, `channels[x].accounts`, `auth`)
  you must mask it explicitly or it leaks over the gateway RPC to any connected client.
- **If the new key should be patchable at runtime** via the gateway's `config.patch` method, add it to
  `ALLOWED_TOP_LEVEL` in `patch.ts` and to `ConfigPatchInput`, with explicit validation — this is a
  deliberately narrow allowlist (currently `agents`, `defaultAgent`, `harness`, `channels` only) precisely
  to keep provider credentials and auth settings out of reach of remote patch calls.
- `resolveProviderConfig`'s merge order (`base` → `by providerId` → `by ownerPluginId`) is relied on by
  provider plugins to let per-plugin config override per-provider config; changing the precedence order
  would change which value wins when both `pluginConfig[providerId]` and `pluginConfig[ownerPluginId]` set
  the same key.
