# @yggdrasil/sdk

## Purpose

This package is the plugin contract for the whole platform — pure TypeScript types plus two trivial
identity helper functions (`definePlugin`, `defineChannelEntry`). It defines what a harness, a channel, a
provider, and a plugin *are* (their required methods and shapes), and what the plugin manifest format
(`yggdrasil.plugin.json`) looks like. It has almost no runtime behavior of its own; its job is to be the
one place both plugin authors and the kernel/pipeline/gateway agree on for these shapes, so a plugin built
in `extensions/` compiles against the same interfaces the kernel registry enforces. Nearly every other
package in the monorepo depends on it, directly or transitively.

## Public API

`packages/sdk/src/index.ts` re-exports `harness.ts`, `channel.ts`, `provider.ts`, `plugin.ts`, `manifest.ts`.

**harness.ts** — the agent-harness contract (a harness is what actually drives an LLM call / tool loop for
one turn):
- `AgentHarness` — `{ id, label, pluginId?, supports(ctx), runAttempt(params), classify?, compact?, reset?, dispose? }`.
  `supports()` returns a `HarnessSupport` (`{supported:true, priority?, reason?}` or `{supported:false, reason?}`)
  used by harness-runtime's selection logic.
- `HarnessAttemptParams` / `HarnessAttemptResult` — input/output of one `runAttempt` call, including
  `onDelta` streaming callback, `approveTool` (a `ToolApprovalHandler`), and `sessionAppend` for
  intermediate tool-loop messages.
- `HarnessCompactParams`/`Result`, `HarnessResetParams`, `HarnessResultClassification` (`"ok"|"error"|"retry"|"fallback"`).
- `RegisteredAgentHarness` — `{ harness, ownerPluginId? }`, the shape stored in the kernel registry.
- `ToolApprovalRequest` / `ToolApprovalHandler` — the human-in-the-loop tool approval callback shape.
- `EventBus`, `EventHandler`, `PluginLogger`, `ConfigSchema` — small shared utility types also used by
  `plugin.ts`.

**channel.ts** — the channel contract (a channel is an inbound/outbound message surface: TUI, HTTP, Telegram…):
- `ChannelPlugin` — `{ id, meta, capabilities, config: ChannelConfigAdapter, gateway?, outbound?, lifecycle? }`.
- `ChannelConfigAdapter` — `listAccountIds()` / `resolveAccount(id)`, how a channel enumerates its configured accounts.
- `ChannelGatewayAdapter` — `startAccount(ctx)` / `stopAccount(ctx)`, how the gateway starts/stops a channel account.
- `ChannelOutboundAdapter` — `sendText?` / `sendBlock?` (streaming) / `sendFinal?`, keyed by `deliveryMode: "direct"|"gateway"|"hybrid"`.
- `ChannelLifecycleAdapter` — `onStart?()` / `onStop?()`, called by kernel's `startKernel`/`stopKernel`.
- `NormalizedInboundMessage` — the canonical inbound message shape every channel adapter produces.
- `ChannelTurnAdmission` (`"dispatch"|"observeOnly"|"drop"`) and `ChannelTurnResult`.

**provider.ts** — the LLM provider contract:
- `ProviderPlugin` — `{ id, label, listModels(ctx), resolveApiKey?(ctx), chatComplete(ctx, params), chatCompleteStream? }`.
- `ChatMessage`, `ChatCompleteParams`, `ChatCompleteResult`, `ChatStreamEvent`, `ChatToolCall`,
  `ChatToolDefinition` — the OpenAI-chat-shaped message/tool-calling types used across providers and harnesses.
- `ProviderModel` — `{ id, label, provider, contextWindow?, supportsTools? }`.

**plugin.ts** — the top-level plugin registration contract:
- `YggdrasilPlugin` — `{ id, name?, version?, configSchema?, register(api) }`.
- `YggdrasilPluginApi` — the object passed into `register()`: `pluginId`, `config`, `globalConfig`, `logger`,
  `events`, and the `register*` methods (`registerHarness`, `registerChannel`, `registerProvider`,
  `registerTool`, `registerGatewayMethod`, `registerService`, `registerContextProvider`) — implemented in
  `@yggdrasil/kernel`'s `plugin-api.ts`.
- `definePlugin(def)` — identity function, exists purely so plugin authors get type-checking/autocomplete.
- `defineChannelEntry(channel)` — same, for channel plugin entry files.
- `GatewayRequest`/`GatewayResponse`/`GatewayHandler`/`GatewayHandlerContext` — the JSON-RPC-ish shape used
  by the gateway's WebSocket protocol and by plugin-registered custom methods.
- `ToolFactory`, `ToolRegistration`, `AgentTool` (deprecated — superseded by `AgentToolDefinition`).
- `ServicePlugin` — `{ id, start(ctx), stop?() }`, long-running background services.
- Re-exports `AgentToolDefinition` from `@yggdrasil/tools-sdk` and `ContextProviderRegistration`/
  `ContextProvider`/`ContextBlock`/`ContextProviderContext` from `@yggdrasil/context-sdk`, so consumers only
  need to import from `@yggdrasil/sdk`.

**manifest.ts** — the `yggdrasil.plugin.json` format:
- `YggdrasilPluginManifest` — `{ id, kind?, entry, name?, version?, channels?, compat? }`.
- `PLUGIN_MANIFEST_FILENAME` = `"yggdrasil.plugin.json"`.
- `CURRENT_PLUGIN_API_VERSION` = `"0.3.0"`.
- `isPluginApiCompatible(required?)` — checks a manifest's `compat.pluginApi` (`">=x.y.z"` or exact) against
  `CURRENT_PLUGIN_API_VERSION`.
- `parsePluginManifest(raw)` — validates/normalizes a raw JSON object into `YggdrasilPluginManifest`, throws
  on missing `id`/`entry`.

## Depends on

- **`@yggdrasil/context-sdk`** — for `ContextProviderRegistration` and related context-block types,
  re-exported so plugin authors get the whole surface from one import.
- **`@yggdrasil/tools-sdk`** — for `AgentToolDefinition`, `ToolParameterSchema` (used in
  `ChatToolDefinition.function.parameters`), and `ToolRiskLevel` (used in `ToolApprovalRequest`).

## Used by

Nearly everything. By import count: `packages/kernel` (all registry/lifecycle types), `packages/pipeline`
(`turn-kernel.ts` — `ChannelPlugin`, `ChatMessage`, `NormalizedInboundMessage`, `ToolApprovalHandler`,
`EventBus`, `OutboundContext`, `OutboundFinal`), `packages/gateway` (`GatewayRequest`/`GatewayResponse`
in `server.ts`, `GatewayHandlerContext` in `methods.ts`, `ToolApprovalHandler`), `packages/harness-runtime`
and `packages/harness-llm` (`AgentHarness`, `HarnessAttemptParams/Result`), `packages/context-runtime` and
the `context-*` packages (`ContextProvider` types), every channel package (`channel-tui`, `channel-http`,
`extensions/channel-telegram`, `extensions/echo-channel` — `ChannelPlugin`, `NormalizedInboundMessage`,
`defineChannelEntry`), every provider package (`provider-ollama`, `provider-openai-compat` — `ProviderPlugin`,
`ChatMessage`), every tool extension (`extensions/tool-datetime`, `extensions/my-tool`,
`extensions/tool-destructive-demo`, `packages/tool-system`, `packages/tool-weather` — `definePlugin`,
tool registration types), and `packages/cli` (`ToolApprovalHandler`, plugin scaffolding in `plugin-commands.ts`).
`@yggdrasil/config` lists `@yggdrasil/sdk` as a dependency in its `package.json` but does not currently
import anything from it in `src/` — worth double-checking before relying on that if you touch `config`'s
dependency list.

## Configuration

None. This package defines types and two identity functions; it does not read `YggdrasilConfig` or any
config file itself.

## Extending / what's safe to change

- **This package is the contract, not the implementation.** Changing any exported type here is a breaking
  change for every plugin in `extensions/` and every package listed above — treat edits as you would a
  public API version bump. If you add a required field to `AgentHarness`, `ChannelPlugin`, or `ProviderPlugin`,
  every existing plugin (bundled and third-party) breaks until updated.
- **Adding a new optional capability** (e.g. a new optional method on `ChannelOutboundAdapter`) is safe and
  the idiomatic way to extend a contract without breaking existing implementations — mark it `?`.
- **`CURRENT_PLUGIN_API_VERSION` in `manifest.ts` is the compatibility gate** — `plugin-loader.ts` in
  `@yggdrasil/kernel` calls `isPluginApiCompatible` to skip plugins whose manifest declares an incompatible
  `compat.pluginApi`. Bump this version string when you make a breaking contract change, so old plugins fail
  to load cleanly instead of crashing at runtime.
- `definePlugin`/`defineChannelEntry` are intentionally just identity functions for type inference — don't
  add runtime logic to them; plugin authors expect them to be side-effect-free.
