# Yggdrasil

Plug-and-play agent platform — the world tree spine for channels, harnesses, and providers.

> **Status: pre-1.0.** APIs and file formats can still change. Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## What's in the box

- **Gateway** — a WebSocket RPC bus that connects channels (terminal, HTTP, Discord, Slack, Telegram), agent harnesses,
  tools and LLM providers (Anthropic, Ollama, any OpenAI-compatible API).
- **Plugin system** — channels, tools, harnesses and providers are plugins loaded from `extensions/` or
  `node_modules/@yggdrasil/*`, without modifying the core.
- **CLI** (`@yggdrasil/cli`) — `init`, `run`, `tui`, `gateway`, plugin install and scaffolding.
- **Desktop app** (`packages/app-desktop`, Electron) — chat, terminals running agents side by side, Documents (a notes
  folder agents can read and write), workflows, a file viewer (including 3D models and audio), skills registry, and
  project management.
- **Mobile client** (`mobile/app`, Flutter) — talks to your gateway from your phone.

## Architecture

- **Kernel** (`@yggdrasil/kernel`) — plugin registry, discovery, lifecycle
- **SDK** (`@yggdrasil/sdk`) — public contracts for extensions
- **Pipeline** (`@yggdrasil/pipeline`) — unified message path: channel → harness → outbound
- **Gateway** (`@yggdrasil/gateway`) — WebSocket RPC bus
- **Harness Runtime** (`@yggdrasil/harness-runtime`) — harness selection + builtin echo
- **Tools Runtime** (`@yggdrasil/tools-runtime`) — tool registry + execution loop
- **Sessions** (`@yggdrasil/sessions`) — persistence, compaction, token budgets
- **Channel TUI** (`@yggdrasil/channel-tui`) — terminal as first-class channel

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full picture.

## Quick start (monorepo)

Requirements: Node >= 22 and pnpm.

```bash
pnpm install
pnpm build
pnpm test          # unit + integration + e2e with mock providers
pnpm test:live     # Ollama Cloud (requires OLLAMA_API_KEY)
node packages/cli/dist/index.js tui
```

To run the desktop app from source:

```bash
pnpm desktop
```

## Install (npm)

```bash
pnpm add @yggdrasil/cli
npx yggdrasil init
npx yggdrasil plugin install @yggdrasil/tool-weather
export OLLAMA_API_KEY=...
npx yggdrasil tui
```

See [installing from npm](docs/installation.md). With an LLM provider, set `OLLAMA_API_KEY` or `OPENAI_API_KEY`
(see [provider config](docs/provider-config.md)).

## CLI

```bash
yggdrasil init                           # create yggdrasil.config.json
yggdrasil run                            # gateway + all enabled channels
yggdrasil tui                            # gateway with TUI channel
yggdrasil gateway                        # headless gateway
yggdrasil plugin install <package>       # npm add + enable plugin
yggdrasil create-plugin my-tool --kind tool
```

## Docs

See [`docs/`](docs/README.md). Part of the documentation is written in Spanish.

- [Iteration roadmap](docs/roadmap-iteraciones.md)
- [Web console](docs/web-console.md)
- [Sessions and memory](docs/sessions.md) — compaction, `sessions.patch`, `tools.list`
- [Testing](docs/testing.md) — E2E layers, Ollama Cloud live tests
- [Creating plugins](docs/creating-plugins.md)
- [Provider configuration](docs/provider-config.md)

## Create a plugin

```bash
node packages/cli/dist/index.js create-plugin my-tool --kind tool
cd extensions/my-tool && pnpm install && pnpm build
```

Plugins load from `extensions/` and `node_modules/@yggdrasil/*` without modifying the CLI. See `extensions/echo-channel/`
for a minimal channel example.

## Bring your own credentials

Nothing in this repository ships with credentials or a hosted backend:

- **LLM providers** — set `OLLAMA_API_KEY` / `OPENAI_API_KEY` etc. ([provider config](docs/provider-config.md)).
- **GitHub / Google connectors** — create your own OAuth app and set `GITHUB_OAUTH_CLIENT_ID` (Device Flow enabled) or
  `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`.
- **Sync / phone hub** — self-host `packages/sync-server` (see `deploy/railway/`) and enter its URL in the desktop app's
  settings.
- **Mobile push** — add your own Firebase config, see [`mobile/app/README.md`](mobile/app/README.md).
- **Desktop auto-update** — off by default; set `YGGDRASIL_UPDATE_URL` to a feed you host.

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).
Released under the [MIT License](LICENSE). Third-party notices: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
Voice features download third-party models at runtime (Whisper, Piper voices); check their individual licenses before
redistributing builds that bundle them.
