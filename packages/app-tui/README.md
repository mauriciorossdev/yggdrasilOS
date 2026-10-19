# @yggdrasil/app-tui

## Purpose

The rich interactive terminal client for Yggdrasil — a standalone React + Ink application that connects to a running gateway over WebSocket and renders the chat as a real UI (markdown, syntax-highlighted code, diffs, tool-call cards, approval prompts, a command palette, a config/model picker, a session browser). This is the surface most people mean when they say "the TUI" — it is what a human actually runs and looks at day to day, and it is where LLM output ends up rendered to a human (this is the process that showed raw JSON tool-call text as a plain assistant message when `provider-ollama` failed to emit structured `tool_calls`; that bug was mitigated upstream in `provider-ollama`, not here — see `packages/provider-ollama/src/messages.ts` / `client.ts`).

It is a completely different thing from `@yggdrasil/channel-tui` — see that package's README for the full comparison. Short version: `channel-tui` runs inside the gateway process and talks to its own stdin/stdout; `app-tui` is a separate process that talks to the gateway over WebSocket.

## Public API / How you run it

This package is an app, not a library consumed by other packages' source. Two entry points:

- **CLI binary** — `bin: yggdrasil-tui` → `dist/cli.js` (source: `src/cli.ts`). Parses `--connect <ws-url>` (or `--connect=<url>`), defaults to `ws://127.0.0.1:18789`, and renders `<App gatewayUrl>` with Ink.
- **Library entry** — `src/index.ts` exports `launchTui(options): Promise<(() => void) | undefined>` (`src/launch.ts`). Renders the same `<App>` and returns an `unmount` callback once the Ink app exits. This is how `packages/cli/src/index.ts` embeds it (`await import("@yggdrasil/app-tui")` inside `cmdTui()`), rather than shelling out to the `yggdrasil-tui` binary.

In practice you run it via `yggdrasil tui` (from `@yggdrasil/cli`), not directly.

### Code shape (for orientation, not exhaustive)

- `src/client/gateway-client.ts` — `GatewayClient`, an `EventEmitter` wrapping a `ws` WebSocket connection to the gateway. `connect()`/`disconnect()`, auto-reconnect with a 2s backoff, `call(method, params, timeoutMs)` for request/response RPC (`{ id, method, params }` → matched by `id`), and emits typed events (`chat.delta`, `chat.final`, `turn.start`, `turn.end`, `tool.execute`, `tool.approval.requested`, `tool.approval.resolved`, `connected`, `disconnected`, `error`) for anything the gateway pushes as `{ type: "event", event, payload }`.
- `src/client/types.ts` — payload/type definitions for the above.
- `src/state/store.ts` — `TuiState`, `TuiAction` union, and `tuiReducer` — a single `useReducer` state machine driving the whole app (messages, streaming buffer, active view, agents/providers list, pending tool approval, session list, config, input history, scroll offset).
- `src/hooks/useGatewayEvents.ts` — subscribes a `GatewayClient` to the reducer, filtering events by the current `sessionKey`.
- `src/hooks/useKeybinds.ts` — global key handling (Ctrl+C to exit, Ctrl+K to toggle the command palette, Escape to pop the current view, PageUp/PageDown or Shift+Arrow to scroll).
- `src/hooks/useTerminalSize.ts` — tracks terminal columns/rows for layout and markdown wrap width.
- `src/components/App.tsx` — the root component: owns the `GatewayClient` instance, does the initial handshake (`agents.list`, `providers.list`, `config.get`, optionally resuming a session via `sessions.list`/`sessions.get` when `--continue` is passed), implements every slash command, and switches between view modes (`chat`, `config`, `sessions`, `command-palette`).
- `src/components/` — `MessageList`, `MessageItem`, `StreamingMessage`, `ToolCallView`, `InputBox`, `StatusBar`, `ApprovalPrompt`, `CommandPalette`, `SlashAutocomplete`, `SessionList`, and `config/` (`ConfigMenu`, `ProviderMenu`, `ModelMenu`, `ApiKeyForm`) for the settings UI.
- `src/render/` — `markdown.ts` (marked + marked-terminal), `highlight.ts` (cli-highlight), `diff.ts`, `theme.ts` (color palette).

### Slash commands (handled in `App.tsx`'s `handleSlashCommand`)

`/reset`, `/agent <id>`, `/sessions`, `/config`, `/model`, `/compact`, `/export`, `/new`, `/status`, `/help`, `/exit` (`/quit`).

### Session key format

`buildSessionKey("tui", "default", "<senderIdPrefix>-<uuid>")` — `senderIdPrefix` is a hash of the workspace root (`workspaceSenderPrefix` in `packages/cli/src/index.ts`), so `--continue` can find "the most recent TUI session for this path" via `sessions.list`.

## Depends on

- `@yggdrasil/config` — `buildSessionKey`.
- `@yggdrasil/sdk` — plugin/type surface shared across the codebase (mostly types here).
- `ink`, `react`, `ink-spinner`, `ink-text-input` — the terminal UI framework.
- `ws` — WebSocket client.
- `marked`, `marked-terminal`, `cli-highlight` — markdown/code rendering in the terminal.
- `fuzzysort` — fuzzy matching for the command palette / slash autocomplete.

## Used by

- `packages/cli/src/index.ts` — dynamically imports `@yggdrasil/app-tui` inside `cmdTui()` for the default `yggdrasil tui` path (both the "attach to an already-running gateway" branch and the "spawn a gateway then launch" branch).

Nothing else in the workspace depends on it — it's a leaf application.

## Configuration

Reads no config file directly. It receives its gateway URL and session behavior as constructor/CLI options (`gatewayUrl`, `senderIdPrefix`, `continueSession`); the actual `yggdrasil.config.json` (agents, providers, harness policy) is fetched over the wire via `config.get`, `agents.list`, `providers.list` RPC calls once connected, and edited through the `ConfigMenu` UI via `config.patch`.

## Extending / what's safe to change

- **New slash command**: add a `case` in `handleSlashCommand` in `App.tsx`, and usually a matching entry in the `commands` array (for the command palette) and the `/help` text.
- **New component**: drop it under `src/components/`, wire it into `App.tsx`'s render tree under the relevant `state.viewMode` branch. Follow the existing pattern of pure presentational components fed by `state`/`dispatch` from the reducer rather than owning their own gateway calls, except where a component (like `ConfigMenu`) explicitly needs `client` for its own RPCs.
- **New gateway event**: add the payload type to `client/types.ts`, add it to `GatewayClientEvents` in `gateway-client.ts`, subscribe in `useGatewayEvents.ts`, and add a `TuiAction` + reducer case in `state/store.ts`.
- **Rendering tweaks** (markdown, syntax highlighting, diffs, color theme) live entirely in `src/render/` and are self-contained — safe to iterate on without touching state/client code.
- Tests exist for the pure logic modules (`render/diff.test.ts`, `render/markdown.test.ts`, `state/store.test.ts`) — the reducer and render helpers are the easiest places to add coverage; components and the WebSocket client are not currently under test here.
