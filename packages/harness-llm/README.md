# @yggdrasil/harness-llm

## Purpose

The real, LLM-backed `AgentHarness` implementation. It turns an inbound message plus session history into a provider call, optionally lets the model call tools over one or more iterations, and returns the final assistant reply. This is what actually "runs the agent" for any turn that isn't handled by the trivial `builtin-echo` harness from `@yggdrasil/harness-runtime`.

Two files carry the logic:
- `src/harness.ts` — the `AgentHarness` itself: resolves a provider, resolves a default model and API key, builds the message list, resolves available tools, and delegates the actual multi-turn/tool-calling work to `runToolLoop`.
- `src/tool-loop.ts` — provider-agnostic tool-calling loop: calls the provider, and if it asks for tool calls, executes them (with optional approval gating and optional parallelism) and loops back, up to a max iteration count.

## Public API

From `src/index.ts`:

- `createLlmHarness(options?: { config?: YggdrasilConfig }): AgentHarness` (`src/harness.ts`) — builds the harness object (`id: "llm"`, see `LLM_HARNESS_ID`). Its `supports(ctx)` returns `{ supported: false }` if `ctx.provider === "builtin"` or if `getProvider(ctx.provider)` (from `@yggdrasil/kernel`) has no `chatComplete`; otherwise `{ supported: true, priority: 100 }` — this is what lets it consistently outrank `builtin-echo` (priority `0`) in `harness-runtime`'s `selectHarness`.
- `llmHarnessPlugin` (default export too) — a `definePlugin(...)`-wrapped plugin (`id: "harness-llm"`) whose `register(api)` calls `api.registerHarness(createLlmHarness({ config: api.globalConfig }))`. This is what the plugin loader actually loads via `yggdrasil.plugin.json` → `entry: "./dist/index.js"`.
- `LLM_HARNESS_ID = "llm"`.
- `runToolLoop(options: ToolLoopOptions): Promise<HarnessAttemptResult>` (`src/tool-loop.ts`) — exported so it can be tested/reused independent of `createLlmHarness`'s provider/config-resolution wiring. Also re-exports its option/event types: `ToolLoopOptions`, `ToolExecuteEvent` (`{ name, durationMs, ok }`), `ProviderLatencyEvent` (`{ model, durationMs, iteration }`).

### `runToolLoop` behavior (the part worth understanding in detail)

Given `messages`, `tools` (already OpenAI-shaped), and a `provider`, it:
1. Calls `provider.chatCompleteStream` if `streaming !== false` and the provider implements it, otherwise falls back to `provider.chatComplete`. Streaming deltas are forwarded via `onDelta`.
2. If the result's `finishReason === "tool_calls"`, appends an `assistant` message carrying `tool_calls`, then executes each call:
   - Looks up the tool's definition via `getToolDefinition(name)` (backed by `@yggdrasil/tools-runtime`'s `getTool`). If `def.requiresApproval` or `def.riskLevel === "destructive"`, and an `approveTool` callback was supplied, it calls that first; a `false`/denied result short-circuits to a `tool` message with content `"Error: tool execution denied by user"` and the tool is never actually invoked.
   - Otherwise calls `executeTool(name, args)` (backed by `@yggdrasil/tools-runtime`'s `executeTool`), stringifying non-string results with `JSON.stringify`, and catching exceptions into an `"Error: ..."` tool message so a single bad tool call doesn't kill the loop.
   - Runs all calls from one turn in parallel (`Promise.all`) unless `parallelToolCalls === false`, in which case they run sequentially — but the resulting `tool` messages are always appended in the original `toolCalls` order regardless of completion order (see `tool-loop-advanced.test.ts`, "preserves tool message order").
   - Appends one `tool` message per call (`tool_call_id`, `name`, `content`) and loops back to call the provider again.
3. Stops and returns `{ text, usage, classification: "ok", metadata: { model, toolIterations }, sessionAppend }` as soon as a turn doesn't ask for tool calls. `sessionAppend` is every message appended since the original `messages` array (the assistant/tool exchanges), for the caller to persist into session history.
4. If `maxIterations` is exhausted without a final answer, returns `classification: "error"` with text `"Tool loop exceeded maximum iterations"` (still including whatever `sessionAppend` accumulated).
5. `usage` is accumulated across iterations (`inputTokens`/`outputTokens` summed per call), not just the last call's usage.
6. Optional observability hooks: `onToolExecute(event)` fires after every tool call (success or failure) with timing; `onProviderLatency(event)` fires after every provider call with `{ model, durationMs, iteration }`.

## Depends on

- `@yggdrasil/kernel` — `getProvider` to resolve the `ProviderPlugin` for `params.provider` (both in `supports()` and `runAttempt()`).
- `@yggdrasil/config` — `resolveProviderConfig` to pull provider-specific config (e.g. `defaultModel`), and the `YggdrasilConfig` type for reading `harness.maxToolIterations` / `harness.streaming` / `harness.parallelToolCalls`.
- `@yggdrasil/provider-openai-compat` — only for the `OPENAI_COMPAT_PROVIDER_ID` constant, used to special-case the default model (`"gpt-4o-mini"`) and the "missing API key" error message when the resolved provider is specifically `openai-compat`.
- `@yggdrasil/tools-runtime` — `resolveTools` (builds the list of tools available for this turn from `ToolContext`), `toolsToOpenAI` (converts to the `ChatToolDefinition[]` shape providers expect), `executeTool` (runs a named tool with args), `getTool` (looks up a tool's definition, used for the approval-risk check).
- `@yggdrasil/tools-sdk` — `AgentToolDefinition` type (what `getToolDefinition` returns; carries `requiresApproval`/`riskLevel`).
- `@yggdrasil/sdk` — `definePlugin`, `AgentHarness`/`HarnessAttemptParams`/`HarnessAttemptResult`/`HarnessSupportContext` (the harness contract), `ProviderPlugin`/`ChatCompleteParams`/`ChatCompleteResult`/`ChatMessage`/`ChatStreamEvent`/`ChatToolDefinition`/`ChatToolCall`/`ToolApprovalHandler` (the provider/chat wire types).

## Used by

Not statically imported by any other package in the repo (a grep across `packages/*/src` and `packages/*/package.json` for `@yggdrasil/harness-llm` only turns up this package's own `package.json`). It's picked up purely through the dynamic plugin system: `yggdrasil.plugin.json` (`{ id: "harness-llm", kind: ["harness"], entry: "./dist/index.js" }`) is discovered by `@yggdrasil/kernel`'s plugin loader (`packages/kernel/src/plugin-loader.ts`) when `config.plugins.discoverNodeModules` is true (default) and the built package sits under `node_modules/@yggdrasil/harness-llm`, or via an explicit path in `config.plugins.load.paths`. Once loaded, its default export (`llmHarnessPlugin`) is registered and calls `api.registerHarness(...)`, after which `@yggdrasil/harness-runtime`'s `selectHarness` and `@yggdrasil/pipeline`'s `ReplyDispatcher` reach it indirectly through `@yggdrasil/kernel`'s `getHarness`/`listHarnesses` registry by ID (`"llm"`), never by importing this package.

## Configuration

Reads (via `YggdrasilConfig["harness"]`, `packages/config/src/index.ts`):
- `harness.maxToolIterations` — default `8` if unset (`config?.harness?.maxToolIterations ?? 8` in `harness.ts`). Caps how many provider round-trips a single turn can take before `runToolLoop` gives up with an error.
- `harness.streaming` — default `true` (`config?.harness?.streaming !== false`). Controls whether `chatCompleteStream` is preferred over `chatComplete` when the provider supports it.
- `harness.parallelToolCalls` — default `true` (`config?.harness?.parallelToolCalls !== false`). Controls whether multiple tool calls from one assistant turn run concurrently or sequentially.

Also reads provider config via `resolveProviderConfig(config, params.provider)` — e.g. `providers.openai-compat.defaultModel` — to pick a default model when `params.modelId` isn't set.

Note: `harness.toolApproval` (`"always" | "destructive-only" | "never"`) exists in `YggdrasilConfig` but is read by `@yggdrasil/cli` to *build* the `approveTool` callback passed into `HarnessAttemptParams`, not by this package — `harness-llm`/`tool-loop.ts` just calls whatever `approveTool` it's given.

## Extending / what's safe to change

- **Adding a new harness**: don't modify this package — implement a new `AgentHarness` (see the `AgentHarness` type in `@yggdrasil/sdk`), give it a distinct `id` and a `supports()` that returns a `priority` reflecting how it should rank against `"llm"` (`100`) and `"builtin-echo"` (`0`), wrap it in `definePlugin(...)`, and ship it with its own `yggdrasil.plugin.json` so the plugin loader picks it up. `@yggdrasil/harness-runtime`'s `selectHarness` will start considering it automatically.
- **Changing tool-loop iteration behavior**: `runToolLoop` in `src/tool-loop.ts` is the single place this happens. To change the iteration cap, prefer the `harness.maxToolIterations` config key over hardcoding — `createLlmHarness` already threads it through. To change what counts as "needs approval," edit the check in `executeOneToolCall` (`def?.requiresApproval || def?.riskLevel === "destructive"`) — currently any `requiresApproval` tool or any `"destructive"`-risk tool triggers the `approveTool` callback if one was supplied; if none was supplied, approval-required tools currently execute unguarded (the gate is only entered `if (needsApproval && options.approveTool)`), so a harness caller that wants approval enforced must always pass `approveTool`.
- **Changing parallel-vs-sequential tool execution**: controlled by `parallelToolCalls` in `ToolLoopOptions`; sequential mode is a plain `for` loop over `executeOneToolCall`, so it's safe to add e.g. per-call timeouts or cancellation there without touching the parallel path.
- **Swapping the provider format**: this package is provider-agnostic by design — it only calls the `ProviderPlugin` interface (`chatComplete`/`chatCompleteStream`) from `@yggdrasil/sdk`. Anything that implements that interface (like `@yggdrasil/provider-openai-compat` or `provider-ollama`) works here without changes to `tool-loop.ts`; the only provider-specific code in this package is the small `OPENAI_COMPAT_PROVIDER_ID` special-casing in `harness.ts` for default model/API-key-missing messaging.
