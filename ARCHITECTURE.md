# Yggdrasil — Architecture

This is the map: what the system looks like as a running whole, how a message flows through it, and where to go for common changes. Most packages have their own `README.md` with exports, dependencies, config keys and notes on what is safe to change; read this first, then the README of whatever you are touching.

Yggdrasil is a **desktop agentic development environment** built on a plugin platform: a long-running gateway process that receives chat messages from one or more "channels" (a terminal UI, an HTTP webhook, Telegram, ...), routes each message through a "harness" (usually an LLM tool-calling loop) against a "provider" (OpenAI, Ollama, ...), and sends a reply back out. The desktop app is the main way people use it: it runs agent CLIs in terminals and talks to one gateway per open project. Almost everything extensible — channels, harnesses, providers, tools, context sources — is a **plugin**: an independently-built package with a `yggdrasil.plugin.json` manifest that registers itself into a shared kernel registry at startup. The kernel doesn't know what a "Telegram channel" or a "weather tool" is; it only knows the shapes defined in `@yggdrasil/sdk` and a registry to put implementations of those shapes into.

## The desktop app

`packages/app-desktop` is an Electron app:

- **Main process** (`src/main`) owns terminals (node-pty), git worktrees, settings, the plugin sandbox, and a loopback server that agent panes use to talk back to the app. It starts one gateway subprocess per open project and points its plugin discovery at the app's own `@yggdrasil/*` packages through `plugins.load.paths`.
- **Renderer** (`src/renderer`) is a React app: terminals, Agent Flow, workflows, worktrees, Documents, Studio, Dashboard and chat. It shares components and theme with the web console through `packages/ui-kit`.
- **Agent CLIs** (Claude Code, Copilot CLI, Antigravity, omp) are installed by the user and run as processes in terminal panes; they do not go through the gateway's harness.

## Runtime topology

Besides the desktop app, which is a client of its gateways, there are two kinds of process:

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

1. The CLI registers the built-in echo harness itself; the tools in `tool-builtin` are always added by `tools-runtime`.
2. **Discovers** everything else by scanning `packages/*`, `extensions/*`, any `plugins.load.paths`, and (unless disabled) `node_modules/@yggdrasil/*` for `yggdrasil.plugin.json` manifests, filtering by `compat.pluginApi` against the SDK's `CURRENT_PLUGIN_API_VERSION`, then dynamically `import()`-ing each entry file and calling `register(api)`.
3. Registrations land in a **single global registry** (`@yggdrasil/kernel`'s `registry.ts`, stashed on `globalThis` behind a `Symbol.for` key so it survives module-instance duplication). Every other package that needs a plugin instance looks it up by id through the registry (`getProvider(id)`, `getHarness(id)`, `getChannel(id)`, `listContextProviders()`, `getRegistry().tools`).

Registration conflicts: `registerChannel` silently keeps the first registration on an id collision; `registerProvider`/`registerHarness` silently overwrite with the last one registered. Discovery order is `packages/` → `extensions/` → `plugins.load.paths` → node_modules, so that's also the collision-resolution order.

These are platform plugins. The desktop app has its own, separate kind (*complementos*: sandboxed HTML views and widgets), built from the Studio.

## Package map

Generated from each `package.json` description with `pnpm package-map`.

<!-- package-map:start -->

### `packages/` — the platform and the apps

| Package | Role |
|---|---|
| [`app-avatar`](packages/app-avatar) | Voice avatar client (Windows) for the Yggdrasil gateway — local Whisper STT, configurable LLM provider/model/apiKey. |
| [`app-desktop`](packages/app-desktop) | Desktop ADE (Electron, macOS/Windows/Linux): terminals running agent CLIs, worktrees, Agent Flow, workflows, Studio, Dashboard and chat. |
| [`app-tui`](packages/app-tui) | Terminal client (React + Ink) that talks to a running gateway over WebSocket; what `yggdrasil tui` launches. |
| [`app-voice`](packages/app-voice) | Local web server for realtime voice conversations with a gateway agent. |
| [`channel-http`](packages/channel-http) | Channel plugin with one inbound HTTP webhook, answering as JSON or as server-sent events. |
| [`channel-tui`](packages/channel-tui) | Minimal readline channel running inside the gateway process (legacy terminal mode). |
| [`cli`](packages/cli) | The `yggdrasil` command: boots the kernel and gateway, launches the TUI, manages and scaffolds plugins. |
| [`client-web`](packages/client-web) | Browser-safe WebSocket client + React hook for talking to the Yggdrasil gateway. Shared by web-console and app-desktop. |
| [`config`](packages/config) | Schema, defaults, merging and file I/O of `yggdrasil.config.json`. |
| [`context-memory-db`](packages/context-memory-db) | SQLite long-term memory: a context provider plus memory tools; the desktop app also uses it directly. |
| [`context-memory-local`](packages/context-memory-local) | Context provider for Markdown memory notes on disk. |
| [`context-project`](packages/context-project) | Context provider summarizing the project: git state, language and package manager. |
| [`context-prompt-files`](packages/context-prompt-files) | Context provider that loads Markdown prompt files from configured folders. |
| [`context-runtime`](packages/context-runtime) | Runs the registered context providers, with timeouts and a token budget. |
| [`context-sdk`](packages/context-sdk) | Types for context providers. |
| [`context-system-docs`](packages/context-system-docs) | Ships the platform guides and serves them through the `docs.list` and `docs.get` methods. |
| [`gateway`](packages/gateway) | HTTP and WebSocket RPC server that every channel and client talks to. |
| [`git-worktrees`](packages/git-worktrees) | The rules for creating git worktrees, shared by the gateway and the desktop app. |
| [`harness-llm`](packages/harness-llm) | The LLM harness: calls the provider and runs the tool loop. |
| [`harness-runtime`](packages/harness-runtime) | Chooses the harness for a turn and ships the fallback echo harness. |
| [`kernel`](packages/kernel) | Process-wide plugin registry, discovery and lifecycle. |
| [`pipeline`](packages/pipeline) | Turns one inbound message into one reply: sessions, context, harness and delivery. |
| [`provider-anthropic`](packages/provider-anthropic) | Provider for Anthropic's API. |
| [`provider-ollama`](packages/provider-ollama) | Provider for Ollama's native chat API. |
| [`provider-openai-compat`](packages/provider-openai-compat) | Provider for any OpenAI-compatible chat completions API. |
| [`sandbox-runtime`](packages/sandbox-runtime) | Runs a command as a subprocess with timeout, output limit, filtered environment and allowed root. |
| [`sdk`](packages/sdk) | The plugin contract: types for harnesses, channels, providers, tools and manifests. |
| [`sessions`](packages/sessions) | Conversation history on disk, with compaction and token budgets. |
| [`skill-adapter`](packages/skill-adapter) | Loads skills written as `SKILL.md` files or command TOML. |
| [`skills-sdk`](packages/skills-sdk) | Contract for skills: prompt, tools and context bundled as a plugin. |
| [`sync-server`](packages/sync-server) | Small self-hosted service to share notes or plugin data among a few trusted people. |
| [`tool-agents`](packages/tool-agents) | Tools that let an agent create new agent personas and delegate sub-tasks to other configured agents for Yggdrasil |
| [`tool-builtin`](packages/tool-builtin) | Tools that are always registered: date and time, and echo. |
| [`tool-cli-delegate`](packages/tool-cli-delegate) | Delegates tasks from a Yggdrasil agent turn to the user's own local CLI coding agents (claude, agy), headless, with persistent conversation context. |
| [`tool-desktop`](packages/tool-desktop) | Desktop automation tools for Yggdrasil agents: open apps, screenshots, notifications — bridged into the app-desktop Electron main process over the loopback pane-control server. |
| [`tool-documents`](packages/tool-documents) | Read/list/create/edit/rename/delete tools scoped to a project's notes/ (Documents) folder |
| [`tool-github`](packages/tool-github) | GitHub connector — OAuth Device Flow + github_list_repos/github_clone_repo tools and connectors.github.* gateway methods |
| [`tool-google`](packages/tool-google) | Google Calendar/Gmail connector — OAuth (gateway-initiated-by-phone flow) + gcal_list_events/gcal_create_event/gmail_search/gmail_read tools |
| [`tool-mcp`](packages/tool-mcp) | Bridges MCP (Model Context Protocol) servers into Yggdrasil agent tools |
| [`tool-office`](packages/tool-office) | Office documents for Yggdrasil agents: spreadsheets (.xlsx) that open in the app's workspace and that an agent can read and edit live |
| [`tool-system`](packages/tool-system) | System tools for Yggdrasil agents: filesystem, processes, shell, system info |
| [`tool-weather`](packages/tool-weather) | Demo weather tool plugin for Yggdrasil |
| [`tools-runtime`](packages/tools-runtime) | Builds the tool list for a turn and executes tool calls. |
| [`tools-sdk`](packages/tools-sdk) | Types and the `defineTool` helper for tools. |
| [`ui-kit`](packages/ui-kit) | UI shared by app-desktop and web-console: theme tokens, primitives and the UI-language store. Source-only (no build): each app's Vite compiles it. |
| [`web-console`](packages/web-console) | Browser console served by every gateway at `/ui`. |
| [`workflows`](packages/workflows) | Pure workflow engine for Yggdrasil automations: types, validation, canonical hashing, expressions and the DAG executor — no I/O, no gateway dependency. |

### `extensions/` — plugins outside the core

| Package | Role |
|---|---|
| [`channel-discord`](extensions/channel-discord) | Discord bot channel. |
| [`channel-slack`](extensions/channel-slack) | Slack bot channel. |
| [`channel-telegram`](extensions/channel-telegram) | Telegram bot channel. |
| [`echo-channel`](extensions/echo-channel) | Minimal example channel. |
| [`service-cron`](extensions/service-cron) | Sends messages into the pipeline on cron schedules. |
| [`service-workflows`](extensions/service-workflows) | Runs workflows: the `workflows.*` gateway methods, scheduler and a file store over `@yggdrasil/workflows`. |
| [`tool-browser`](extensions/tool-browser) | Browser automation tools with Playwright. |
| [`tool-datetime`](extensions/tool-datetime) | Example date and time tool. |
| [`tool-destructive-demo`](extensions/tool-destructive-demo) | Example tool that requires approval. |
| [`tool-fetch`](extensions/tool-fetch) | HTTP fetch tool with content extraction. |
| [`tool-fs`](extensions/tool-fs) | File system tools with risk levels. |
| [`tool-image`](extensions/tool-image) | Loads local or remote images for multimodal models. |
| [`tool-search`](extensions/tool-search) | Web search through Brave Search or SearXNG. |
| [`tool-shell`](extensions/tool-shell) | Shell command tool running through the sandbox runtime. |

<!-- package-map:end -->

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

## Extension points

**Add a tool** — write `defineTool({name, description, parameters, riskLevel, execute})` from `@yggdrasil/tools-sdk` (name must be snake_case — some LLM backends reject hyphens). For a single simple tool, copy `tool-weather`'s shape (one `definePlugin` default export + `yggdrasil.plugin.json`); for several tools or anything with real side effects, copy `tool-system`'s shape instead. Set `riskLevel: "destructive"` (or `requiresApproval: true`) for anything that mutates state or runs code — `defineTool` enforces the approval flag automatically for `"destructive"`. Fastest path: `node packages/cli/dist/index.js create-plugin <name> --kind tool`.

**Add a provider** — implement `ProviderPlugin` (`@yggdrasil/sdk`): `listModels`, `resolveApiKey?`, `chatComplete`, `chatCompleteStream?`. Use `provider-openai-compat` as the template if the backend speaks OpenAI's chat-completions format; use `provider-ollama` if it needs a bespoke wire format. `harness-llm` and `pipeline` are provider-agnostic — nothing there needs to change.

**Add a harness** — implement `AgentHarness` (`@yggdrasil/sdk`): `supports(ctx)` (return a `priority` to rank against `harness-llm`'s `100` and `builtin-echo`'s `0`) and `runAttempt(params)`. `harness-runtime`'s `selectHarness` picks it up automatically once registered — no changes needed there.

**Add a channel** — implement `ChannelPlugin` (`@yggdrasil/sdk`): a `config` adapter (list/resolve accounts), a `gateway` adapter (`startAccount`/`stopAccount`), and an `outbound` adapter (`sendText`/`sendBlock`/`sendFinal`). `channel-http` (webhook, stateless) and `channel-tui` (stdin/stdout, stateful/interactive) are the two reference implementations, and `extensions/channel-telegram` is a third-party-style example outside `packages/`.

**Add or activate a context source** — implement `ContextProvider` (`@yggdrasil/context-sdk`): `{id, priority, supports?, assemble(ctx)}` and register it with `api.registerContextProvider(...)`. The `context-*` packages have manifests, so they are discovered, but a provider only runs when its id is listed in `context.defaultProviders` or in an agent's `contextProviders`. Per-provider settings are read from `pluginConfig.<context provider id>`.

## Known gaps

Checked against the code on 2026-11-27:

- **`@yggdrasil/config` declares a dependency on `@yggdrasil/sdk` that its sources do not import.** Harmless, but do not assume `config` exposes SDK types.
- **`tool-system`'s `run_command` has no sandboxing:** it runs on the host with the process's permissions. It is marked `destructive` (approval required). The separate `extensions/tool-shell` does go through `sandbox-runtime`.
- **Gateway tool-approval state is in memory** (10 minute timeout, denied by default): it does not survive a restart and does not span several gateways.
- **Ollama tool calling:** small or quantized local models sometimes print a tool call as raw JSON instead of filling `tool_calls`. `provider-ollama` has a conservative fallback parser (`parseFallbackToolCalls`); extend it if a new model produces another shape.

## Running it

```bash
pnpm install
pnpm build              # pnpm -r run build — compiles all packages (required before running the CLI)
pnpm desktop            # the desktop app
pnpm yggdrasil tui       # interactive TUI, spawns a gateway if none is running
pnpm yggdrasil run       # headless: gateway + channel-tui + channel-http
pnpm yggdrasil gateway   # headless: gateway only, no channels

pnpm test                # unit + integration + e2e mock (no API key needed)
pnpm test:live           # requires OLLAMA_API_KEY, exercises real providers
pnpm typecheck           # pnpm -r run typecheck
```

See `AGENTS.md` at the repo root for the full command reference, test architecture notes, and the plugin-scaffolding command (`create-plugin`).
