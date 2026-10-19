# @yggdrasil/harness-runtime

## Purpose

Runtime support for choosing which `AgentHarness` handles a turn, plus a trivial builtin harness (`builtin-echo`) that guarantees a harness always exists even if no other harness plugin is installed. This package does not implement an LLM-backed harness itself — that's `@yggdrasil/harness-llm` — it implements the *selection* logic that decides which registered harness to invoke, and the fallback that keeps the system usable with zero plugins.

## Public API

From `src/index.ts`:

- `selectHarness(ctx: HarnessSelectionContext): HarnessSelectionResult` (`src/selection.ts`) — the core decision function. `HarnessSelectionContext` is `HarnessSupportContext` (`provider`, `modelId?`, `runtime?`, from `@yggdrasil/sdk`) plus `config: YggdrasilConfig`. Logic:
  - If `config.harness.policy === "pinned"` and `config.harness.pinnedId` is set, look it up via `getHarness()` (`@yggdrasil/kernel`) and use it directly (`reason: "pinned"`) if found.
  - Otherwise (or if the pinned ID isn't registered), call `listHarnesses()` and ask each harness's `supports(ctx)` whether it can handle this turn; rank the supported ones by `priority` (higher wins) and pick the best (`reason: "auto_plugin"` or `"auto_builtin"` if the winner happens to be `builtin-echo`).
  - If nothing supports the context at all, fall back to a fresh `createEchoHarness()` instance (`reason: "auto_builtin"`) rather than throwing.
  - Returns `{ harness, reason, harnessId, candidates }` — `candidates` is the full ranked list (id/priority/supported/reason for each), useful for logging/debugging why a particular harness was picked.
- `createEchoHarness(options?: { id?: string; label?: string }): AgentHarness` (`src/builtin/echo.ts`) — builds a minimal `AgentHarness` whose `runAttempt` just returns `text: "echo: ${params.message}"` with `classification: "ok"`. `supports()` always returns `{ supported: true, priority: 0 }` — lowest realistic priority, so any real harness (e.g. `harness-llm` registers at priority 100) outranks it.
- `BUILTIN_ECHO_HARNESS_ID = "builtin-echo"`.
- `registerBuiltinHarnesses(): void` (`src/builtin/echo.ts`) — calls `registerHarness(createEchoHarness())` (`@yggdrasil/kernel`) to put the echo harness into the global registry. This is called explicitly at startup (not via the plugin-loader manifest system — there's no `yggdrasil.plugin.json` in this package), so the echo harness is always available regardless of what plugins get discovered.

## Depends on

- `@yggdrasil/kernel` — `getHarness`, `listHarnesses`, `registerHarness`: the in-process harness registry that plugins populate via `api.registerHarness(...)`.
- `@yggdrasil/sdk` — `AgentHarness`, `HarnessSupportContext` types that define the harness contract this package selects between.
- `@yggdrasil/config` — `YggdrasilConfig` type, specifically the `harness.policy`/`harness.pinnedId` fields read in `selectHarness`.

## Used by

- `@yggdrasil/pipeline` (`src/turn-kernel.ts`) — `ReplyDispatcher.dispatchToHarness` imports `selectHarness`, `BUILTIN_ECHO_HARNESS_ID`, `createEchoHarness` and calls `selectHarness({ config, provider, modelId, runtime: "default" })` for every turn where the agent doesn't have a harness pinned in its own config (`agent.harness`); if the agent config *does* pin a harness ID it's looked up directly via `getHarness()` instead and `selectHarness` is skipped.
- `@yggdrasil/cli` (`src/index.ts`) — calls `registerBuiltinHarnesses()` at process startup so `builtin-echo` is registered before any turn is dispatched, independent of which plugins get discovered/loaded.

Not consumed via the dynamic plugin-manifest system (no `yggdrasil.plugin.json` here) — both callers import it directly as a regular workspace dependency.

## Configuration

Reads `harness.policy` (`"auto" | "pinned"`, default effectively `"auto"` since `selectHarness` only branches on `"pinned"`) and `harness.pinnedId` from `YggdrasilConfig` (`@yggdrasil/config`, see `packages/config/src/index.ts`). Nothing else in this package reads config directly — `maxToolIterations`/`streaming`/`parallelToolCalls`/`toolApproval` are read by `harness-llm` and the CLI, not here.

## Extending / what's safe to change

- **Changing selection behavior**: `selectHarness` is the single place ranking happens. To change tie-breaking or add a new selection policy (e.g. per-channel pinning), extend the `policy` branch here rather than special-casing it in callers — `ReplyDispatcher` already treats `selectHarness` as the source of truth except for the agent-level pin, which is intentionally handled one layer up (in `pipeline`) since it needs `AgentConfig`, not just `YggdrasilConfig`.
- **Priority values**: any harness registering with `priority` higher than a competing one wins when both `supports()` return `true`. `builtin-echo` is pinned at `0` specifically so it's always the fallback, never a rival — don't raise it. `harness-llm` registers at `100` (see that package's `supports()`); a new harness should generally pick a priority higher than `0` and reason about ordering relative to whatever else might legitimately support the same `(provider, modelId)` pair.
- **Adding a new harness package**: this package doesn't need to change — new harnesses register themselves via `registerHarness()` (usually from a plugin's `register(api)` using `api.registerHarness(...)`, discovered through the plugin manifest system) and `selectHarness` picks them up automatically through `listHarnesses()`. Only touch `harness-runtime` if you need to change the *selection policy itself*, not to add another harness.
- **The echo harness** is deliberately trivial (no provider call, no tools, no streaming) — it exists so the system degrades gracefully rather than throwing when no LLM-backed harness is installed/configured. Don't add real logic to it; if you want smarter offline behavior, that belongs in a real harness with a `supports()` gate.
