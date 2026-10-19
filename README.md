# Yggdrasil

Plug-and-play agent platform — the world tree spine for channels, harnesses, and providers.

> **Status: pre-1.0.** APIs and file formats can still change. Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## Architecture

- **Kernel** (`@yggdrasil/kernel`) — plugin registry, discovery, lifecycle
- **SDK** (`@yggdrasil/sdk`) — public contracts for extensions
- **Pipeline** (`@yggdrasil/pipeline`) — unified message path: channel → harness → outbound
- **Gateway** (`@yggdrasil/gateway`) — WebSocket RPC bus
- **Harness Runtime** (`@yggdrasil/harness-runtime`) — harness selection + builtin echo
- **Tools Runtime** (`@yggdrasil/tools-runtime`) — tool registry + execution loop
- **Sessions** (`@yggdrasil/sessions`) — persistence, compaction, token budgets
- **Channel TUI** (`@yggdrasil/channel-tui`) — terminal as first-class channel

## Quick start (monorepo)

```bash
pnpm install
pnpm build
pnpm test          # unit + integration + e2e mock
pnpm test:live     # Ollama Cloud (requiere OLLAMA_API_KEY)
node packages/cli/dist/index.js tui
```

## Install (npm)

```bash
pnpm add @yggdrasil/cli
npx yggdrasil init
npx yggdrasil plugin install @yggdrasil/tool-weather
export OLLAMA_API_KEY=...
npx yggdrasil tui
```

Ver [instalación desde npm](docs/installation.md).

With an LLM provider, set `OLLAMA_API_KEY` or `OPENAI_API_KEY` (see [provider config](docs/provider-config.md)).

## CLI

```bash
yggdrasil init                           # crear yggdrasil.config.json
yggdrasil run                            # gateway + all enabled channels
yggdrasil tui                            # gateway with TUI channel
yggdrasil gateway                        # headless gateway
yggdrasil plugin install <package>       # npm add + enable plugin
yggdrasil create-plugin my-tool --kind tool
```

## Docs

Ver [`docs/`](docs/README.md):

- [Roadmap de iteraciones](docs/roadmap-iteraciones.md)
- [Web Console](docs/web-console.md)
- [Sesiones y memoria](docs/sessions.md) — compaction, `sessions.patch`, `tools.list`
- [Testing](docs/testing.md) — capas E2E, Ollama Cloud live
- [Crear plugins](docs/creating-plugins.md)
- [Configuración del provider](docs/provider-config.md)

## Create a plugin

```bash
node packages/cli/dist/index.js create-plugin my-tool --kind tool
cd extensions/my-tool && pnpm install && pnpm build
```

Plugins load from `extensions/` and `node_modules/@yggdrasil/*` without modifying the CLI. See `extensions/echo-channel/` for a minimal channel example.

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
