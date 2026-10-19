# Yggdrasil — Architecture

This is the map. Every package under `packages/*` now has its own `README.md` with exports, dependencies, config keys, and concrete "what's safe to change" notes — this document is the connective tissue between them: what the system looks like as a running whole, how a message actually flows through it, and where to go for common changes. Read this first, then drop into the package README for whatever you're touching.

Yggdrasil is a **plug-and-play agent platform**: a long-running gateway process that receives chat messages from one or more "channels" (a terminal UI, an HTTP webhook, Telegram, ...), routes each message through a "harness" (usually an LLM tool-calling loop) against a "provider" (OpenAI, Ollama, ...), and sends a reply back out. Almost everything extensible — channels, harnesses, providers, tools, context sources — is a **plugin**: an independently-built package with a `yggdrasil.plugin.json` manifest that registers itself into a shared kernel registry at startup. The kernel doesn't know what a "Telegram channel" or a "weather tool" is; it only knows the shapes defined in `@yggdrasil/sdk` and a registry to put implementations of those shapes into.

## Runtime topology

There are two kinds of process:

1. **The gateway** (`@yggdrasil/gateway`, launched by `@yggdrasil/cli`) — one long-running Node process. It hosts an HTTP server + WebSocket server (default `127.0.0.1:18789`), starts/stops "channel accounts" (e.g. the HTTP webhook, Telegram bot), and answers JSON-RPC-ish methods (`chat.send`, `sessions.*`, `config.get/patch`, `tools.list`, ...). This is where the kernel plugin registry lives, where `yggdrasil.config.json` is loaded, and where every turn is actually executed.
2. **Clients that talk to the gateway over WebSocket** — `@yggdrasil/app-tui` (the terminal app people actually run — `yggdrasil tui`) and `@yggdrasil/web-console` (a browser UI served by the gateway itself at `/ui`). Neither has any application logic of its own beyond rendering; both are thin clients over the same WS RPC + event-push protocol.

There's a third, easy-to-confuse case: `@yggdrasil/channel-tui` is *not* a client — it's a channel plugin that runs **inside** the gateway process and reads/writes the gateway's own stdin/stdout via `node:readline`. It's the "legacy" terminal mode (`yggdrasil run`, `yggdrasil tui --legacy`), with no WebSocket involved at all. `app-tui` is the one with the polished UI (markdown, tool-call cards, approvals, command palette) and is what `yggdrasil tui` launches by default.

```
                                   ┌─────────────────────────────────────────────┐
                                   │                  gateway process              │
                                   │           (@yggdrasil/gateway + kernel)       │
                                   │                                               │
  yggdrasil-tui (app-tui) ───ws──▶│  WebSocket/HTTP RPC ── channel-manager ──┐    │
  web-console (browser)   ───ws──▶│         │                                │    │
  curl / webhook sender  ───http─▶│  channel-http ────────────────────────┐ │    │
                                   │  channel-tui (own stdin/stdout) ──────┤ │    │
                                   │                                       ▼ ▼    │
                                   │                            @yggdrasil/pipeline│
                                   │                          (runChannelTurn /    │
                                   │                           ReplyDispatcher)    │
                                   │                                       │       │
                                   │        ┌──────────────────────────────┼────┐  │
                                   │        ▼                              ▼    │  │
                                   │  @yggdrasil/sessions          @yggdrasil/context-runtime
                                   │  (history + compaction)       (system-prompt blocks) │
                                   │        │                              │       │
                                   │        └──────────────┬───────────────┘       │
                                   │                        ▼                      │
                                   │              harness-runtime.selectHarness     │
                                   │                        │                      │
                                   │                        ▼                      │
                                   │              @yggdrasil/harness-llm            │
                                   │           (runToolLoop: provider ⇄ tools)      │
                                   │                    │         │                │
                                   │                    ▼         ▼                │
                                   │      provider-ollama /   @yggdrasil/tools-runtime
                                   │      provider-openai-compat  (resolveTools/executeTool)
                                   └─────────────────────────────────────────────┘
```

## A turn, end to end

This is the sequence that runs for every single message, whether it arrives via the TUI, HTTP, or a plugin-provided channel.

1. **Channel receives a message.** Each `ChannelPlugin` (`@yggdrasil/sdk`'s `ChannelPlugin` interface) normalizes whatever it received into a `NormalizedInboundMessage` and hands it to the gateway's `ChannelManager` (`packages/gateway/src/channel-manager.ts`), which calls `ingestInboundMessage` then `runChannelTurn` from `@yggdrasil/pipeline`. (The WebSocket `chat.send` RPC method takes a shortcut straight into the same two calls, bypassing a channel entirely — that's how `app-tui`/`web-console` chat pages work.)
2. **`ReplyDispatcher.dispatchToHarness`** (`packages/pipeline/src/turn-kernel.ts`) resolves the agent (`resolveAgent` from `@yggdrasil/config`, by id or `defaultAgent`), loads and compacts session history (`@yggdrasil/sessions`: `maybeCompactSession`, `trimHistoryToTokenBudget`), assembles context-provider blocks (`@yggdrasil/context-runtime`'s `resolveContext`, prepended ahead of history), and picks a harness — either the agent's pinned `harness` id (looked up directly via `@yggdrasil/kernel`'s `getHarness`) or the winner of `@yggdrasil/harness-runtime`'s `selectHarness` (highest-`priority` registered harness whose `supports()` returns true for this provider/model).
3. **The harness runs the attempt.** In practice this is almost always `@yggdrasil/harness-llm`'s `createLlmHarness` (`priority: 100`) — it resolves the `ProviderPlugin` by id via `@yggdrasil/kernel`'s `getProvider`, resolves the tool list for this turn (`@yggdrasil/tools-runtime`'s `resolveTools` → `toolsToOpenAI`), and runs `runToolLoop` (`packages/harness-llm/src/tool-loop.ts`): call the provider, and if it asks for tool calls, execute them (gated by approval for `destructive`/`requiresApproval` tools) and loop, up to `harness.maxToolIterations` (default 8). If nothing supports the context at all (no provider configured, no plugins loaded), `selectHarness` falls back to `@yggdrasil/harness-runtime`'s trivial `builtin-echo` harness (`priority: 0`) so the system never hard-fails with "no harness."
4. **The provider does the actual LLM call.** `@yggdrasil/provider-ollama` (Ollama's native `/api/chat`) or `@yggdrasil/provider-openai-compat` (any OpenAI-chat-completions-shaped backend — OpenAI, Ollama Cloud, etc.) implement `chatComplete`/`chatCompleteStream` against `@yggdrasil/sdk`'s `ProviderPlugin` interface; `runToolLoop` doesn't know or care which one it's talking to.
5. **Result comes back up.** `dispatchToHarness` appends the exchange to the session store, emits `turn.start`/`turn.end` on the event bus (pushed over WebSocket to any connected client as `{type:"event", ...}`), and `deliverToChannel` sends the final text out through whichever channel's `outbound` adapter originated the turn.

If the primary harness attempt comes back classified `"fallback"` (e.g. provider unreachable), `ReplyDispatcher` retries once against the echo harness rather than surfacing an error all the way to the user — deliberate degrade-gracefully behavior, see `pipeline`'s README for where that decision lives.

## The plugin system

Every extensible piece is a `YggdrasilPlugin` (`@yggdrasil/sdk`'s `plugin.ts`): `{ id, register(api) }`, where `api` (`YggdrasilPluginApi`, built by `@yggdrasil/kernel`'s `createPluginApi`) exposes `registerHarness`, `registerChannel`, `registerProvider`, `registerTool`, `registerGatewayMethod`, `registerService`, `registerContextProvider`. At startup, `bootstrapKernel` (`@yggdrasil/kernel`'s `lifecycle.ts`, called from `@yggdrasil/cli`):

1. Registers a small set of **bundled plugins** directly (no discovery needed) — currently `provider-openai-compat`, `provider-ollama`, `harness-llm`, `tool-system`, `tool-weather` (see `bundledPlugins` in `packages/cli/src/index.ts`).
2. **Discovers** everything else by scanning `packages/*`, `extensions/*`, any `config.plugins.load.paths`, and (unless disabled) `node_modules/@yggdrasil/*` for `yggdrasil.plugin.json` manifests, filtering by `compat.pluginApi` against the SDK's `CURRENT_PLUGIN_API_VERSION`, then dynamically `import()`-ing each entry file and calling `register(api)`.
3. Registrations land in a **single global registry** (`@yggdrasil/kernel`'s `registry.ts`, stashed on `globalThis` behind a `Symbol.for` key so it survives module-instance duplication). Every other package that needs a plugin instance looks it up by id through the registry (`getProvider(id)`, `getHarness(id)`, `getChannel(id)`, `listContextProviders()`, `getRegistry().tools`) — nothing imports a plugin package directly except the small bundled-plugin list and the kernel/CLI wiring itself.

Registration conflicts: `registerChannel` silently keeps the first registration on an id collision; `registerProvider`/`registerHarness` silently overwrite with the last one registered. Discovery order is `packages/` → `extensions/` → `plugins.load.paths` → node_modules, so that's also the collision-resolution order.

## Package map

| Package | Role | Wired in by default? |
|---|---|---|
| `sdk` | Plugin contract types (`AgentHarness`, `ChannelPlugin`, `ProviderPlugin`, manifest format). Nearly everything depends on this. | n/a (types only) |
| `kernel` | Global plugin registry + discovery + lifecycle (`bootstrapKernel`/`startKernel`/`stopKernel`). | n/a (infrastructure) |
| `config` | `YggdrasilConfig` schema, defaults, merge, file I/O, auth resolution, client-safe sanitization, patch whitelist. | n/a (infrastructure) |
| `pipeline` | Turn orchestration: `runChannelTurn` / `ReplyDispatcher`. The one place "what happens per message" is defined. | n/a (infrastructure) |
| `gateway` | HTTP+WS server, channel lifecycle, RPC method dispatch. | Yes — started by `cli` |
| `harness-runtime` | Harness selection (`selectHarness`) + the trivial `builtin-echo` fallback harness. | Yes (registered explicitly at CLI startup) |
| `harness-llm` | The real LLM-backed harness + tool-calling loop (`runToolLoop`). | Yes — bundled plugin |
| `provider-ollama` | `ProviderPlugin` for Ollama's native `/api/chat`. Includes a fallback parser for models that emit malformed tool calls (see below). | Yes — bundled plugin |
| `provider-openai-compat` | `ProviderPlugin` for any OpenAI-chat-completions-shaped backend (OpenAI, Ollama Cloud, ...). Default provider. | Yes — bundled plugin |
| `tools-sdk` | Tool contract (`AgentToolDefinition`, `defineTool`). | n/a (types only) |
| `tools-runtime` | Builds the live tool list per turn, executes tool calls. | n/a (infrastructure) |
| `tool-builtin` | Always-on `datetime`/`echo` tools, registered unconditionally — not a plugin. | Yes — hardcoded |
| `tool-system` | Real host-machine tools: filesystem, processes, shell (`run_command`, `write_file` are `destructive`/approval-gated). | Yes — bundled plugin |
| `tool-weather` | Single mock-data demo tool (`get_weather`). Reference for a minimal tool plugin. | Yes — bundled plugin |
| `context-sdk` | Context-provider contract (`ContextProvider`, `ContextBlock`). | n/a (types only) |
| `context-runtime` | Orchestrates registered context providers into system-message blocks (timeout, cache, token-budget trim). | n/a (infrastructure) |
| `context-memory-db` | SQLite persistent memory + `memory.*` gateway RPC methods. | **No** — fully implemented, not registered anywhere |
| `context-memory-local` | Reads `YGGDRASIL.md` + `.yggdrasil/memory/*.md` (project) + `~/.yggdrasil/memory/*.md` (global). | **No** |
| `context-project` | Git branch/status + detected language/package-manager summary. | **No** |
| `context-prompt-files` | Reads `*.md` files from configured prompt directories. | **No** |
| `channel-http` | Webhook channel, `POST /inbound`, JSON or SSE. | Off by default (`channels.http.enabled`) |
| `channel-tui` | Legacy readline-in-gateway-process terminal channel. | Only via `yggdrasil run` / `tui --legacy` |
| `app-tui` | The real interactive terminal client (Ink/React over WebSocket). `yggdrasil tui`. | n/a (client app) |
| `web-console` | Browser client, built and copied into `gateway/ui`, served at `/ui`. | n/a (client app, always servable) |
| `cli` | `yggdrasil` binary: bootstrap, commands, plugin scaffolding. | n/a (entrypoint) |
| `sessions` | File-backed session history store + compaction + token trimming. | n/a (infrastructure) |
| `extensions/*` | Third-party-style example plugins outside `packages/` (Telegram channel, datetime tool, destructive-tool demo, echo channel). | Depends on manifest discovery |

The four unwired `context-*` packages are real, tested (well — `context-runtime` has tests; the four provider packages themselves don't) code with no `yggdrasil.plugin.json` and no entry in `bootstrapKernel`'s `bundledPlugins`. If you want project/memory/prompt-file context actually showing up in conversations, see "Extension points" below — it's a small wiring job, not a rewrite.

## Configuration

`yggdrasil.config.json` at the workspace root is the single config file (schema owned by `@yggdrasil/config`, see that package's README for the full key list). Highlights relevant to day-to-day work:

- `agents[]` — one or more `{id, label, provider, model, systemPrompt?, harness?, contextProviders?}`. `defaultAgent` picks which one handles a turn when the channel/caller doesn't specify.
- `harness.policy` (`"auto"|"pinned"`), `harness.maxToolIterations` (default 8), `harness.streaming`, `harness.parallelToolCalls`, `harness.toolApproval` (`"always"|"destructive-only"|"never"`).
- `providers.<id>` — per-provider `baseUrl`/`apiKey`/`defaultModel`/`contextWindow`.
- `sessions.{dir,maxMessages,compactThreshold,compactionPolicy,maxTokens}`.
- `channels.<id>.{enabled,accounts}`.
- `plugins.{load.paths, discoverNodeModules, discoverAll, disabled}`, `pluginConfig.<pluginId>`.
- `context.{defaultProviders, tokenBudget}`.
- `auth.{gateway,http}.apiKey` — also settable via `YGGDRASIL_API_KEY` env var.

Only `agents`, `defaultAgent`, `harness`, `channels` are patchable at runtime through the gateway's `config.patch` RPC (`@yggdrasil/config`'s `validateConfigPatch` whitelist) — provider credentials and auth settings are deliberately out of reach of that endpoint.

**The repo's own `yggdrasil.config.json` currently has a live-looking Ollama Cloud API key committed in plaintext** under `providers.openai-compat.apiKey`. It's not tracked by git (confirmed via `git ls-files`), so it's not in history, but treat it as sensitive — move it to an env var or a gitignored file before this project is shared or the config file is ever added to git.

## Extension points

**Add a tool** — write `defineTool({name, description, parameters, riskLevel, execute})` from `@yggdrasil/tools-sdk` (name must be snake_case — some LLM backends reject hyphens). For a single simple tool, copy `tool-weather`'s shape (one `definePlugin` default export + `yggdrasil.plugin.json`); for several tools or anything with real side effects, copy `tool-system`'s shape instead. Set `riskLevel: "destructive"` (or `requiresApproval: true`) for anything that mutates state or runs code — `defineTool` enforces the approval flag automatically for `"destructive"`. Fastest path: `node packages/cli/dist/index.js create-plugin <name> --kind tool`.

**Add a provider** — implement `ProviderPlugin` (`@yggdrasil/sdk`): `listModels`, `resolveApiKey?`, `chatComplete`, `chatCompleteStream?`. Use `provider-openai-compat` as the template if the backend speaks OpenAI's chat-completions format; use `provider-ollama` if it needs a bespoke wire format. `harness-llm` and `pipeline` are provider-agnostic — nothing there needs to change.

**Add a harness** — implement `AgentHarness` (`@yggdrasil/sdk`): `supports(ctx)` (return a `priority` to rank against `harness-llm`'s `100` and `builtin-echo`'s `0`) and `runAttempt(params)`. `harness-runtime`'s `selectHarness` picks it up automatically once registered — no changes needed there.

**Add a channel** — implement `ChannelPlugin` (`@yggdrasil/sdk`): a `config` adapter (list/resolve accounts), a `gateway` adapter (`startAccount`/`stopAccount`), and an `outbound` adapter (`sendText`/`sendBlock`/`sendFinal`). `channel-http` (webhook, stateless) and `channel-tui` (stdin/stdout, stateful/interactive) are the two reference implementations, and `extensions/channel-telegram` is a third-party-style example outside `packages/`.

**Add/activate a context source** — implement `ContextProvider` (`@yggdrasil/context-sdk`): `{id, priority, supports?, assemble(ctx)}`, register via `api.registerContextProvider(...)`, and add its id to `context.defaultProviders` or an agent's `contextProviders`. To turn on the four already-written-but-unwired packages (`context-memory-db`, `context-memory-local`, `context-project`, `context-prompt-files`): give each a `yggdrasil.plugin.json` (copy `extensions/echo-channel`'s manifest shape) or add them to `bundledPlugins` in `packages/cli/src/index.ts`, then list their ids under `context.defaultProviders`. Before relying on per-provider config (e.g. `context-memory-db`'s `dbPath`, `context-prompt-files`' `paths`), fix the config-propagation gap noted below — as written, only the first provider in a resolved list reliably gets its config.

## Known gaps (found while writing this documentation pass)

Worth triaging, not necessarily worth fixing immediately:

- **`context-runtime` config propagation bug** (`packages/pipeline/src/turn-kernel.ts`): the `ContextProviderContext.config` built for a batch of context providers is sourced from `pluginConfig[providerIds[0]]` only — every provider in the batch gets the *same* config, keyed by the first provider's id, and using the context-provider id rather than the plugin id `pluginConfig` is keyed by everywhere else. Per-provider config (`context-memory-db`'s `dbPath`, `context-prompt-files`' `paths`) generally won't reach `assemble()` as configured. Fix: build a per-provider config map in `turn-kernel.ts` keyed correctly by plugin id.
- **`context-memory-db`'s `getMemoryDb` singleton ignores its arguments** on repeat calls — the first caller's `workspaceRoot`/`dbPath` wins for the life of the process. Fine for one workspace per process; wrong for anything multi-tenant.
- **Four `context-*` packages are fully implemented but not wired into any running configuration** (see the package map above) — no manifest, not in `bundledPlugins`, no tests for three of the four.
- **`@yggdrasil/config` declares a dependency on `@yggdrasil/sdk` it doesn't use** — stale, harmless, but don't assume `config` exposes SDK-typed helpers.
- **`tool-system`'s `run_command` has no sandboxing** — it runs on the host with the process's own permissions. It's correctly marked `destructive` (approval-gated), but there's no additional isolation; be deliberate before adding more tools at this trust level.
- **Gateway tool-approval state is process-local and in-memory** (60s timeout, default-deny) — doesn't survive a gateway restart, doesn't work across multiple gateway instances.
- **Ollama tool-calling reliability**: smaller/quantized local models (e.g. `qwen2.5-coder:7b`) sometimes fail to emit Ollama's structured `tool_calls` field and instead print the call as raw JSON text, which used to leak straight to the user. `provider-ollama`'s `messages.ts`/`client.ts` now includes a conservative fallback parser (`parseFallbackToolCalls`) that recovers these cases — see that package's README for exactly what it does and does not catch. If you hit this with a new model's malformed-call shape, extend the parser rather than the model config.

## Running it

```bash
pnpm install
pnpm build              # pnpm -r run build — compiles all packages (required before running the CLI)
pnpm yggdrasil tui       # interactive TUI, spawns a gateway if none is running
pnpm yggdrasil run       # headless: gateway + channel-tui + channel-http
pnpm yggdrasil gateway   # headless: gateway only, no channels

pnpm test                # unit + integration + e2e mock (no API key needed)
pnpm test:live           # requires OLLAMA_API_KEY, exercises real providers
pnpm typecheck           # pnpm -r run typecheck
```

See `AGENTS.md` at the repo root for the full command reference, test architecture notes, and the plugin-scaffolding command (`create-plugin`).
