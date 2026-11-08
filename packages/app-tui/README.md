# @yggdrasil/app-tui

## Purpose

The rich interactive terminal client for Yggdrasil — a standalone React + Ink application that connects to a running gateway over WebSocket and renders the chat as a real UI (markdown, syntax-highlighted code, diffs, tool-call cards, approval prompts, a command palette, a config/model picker, a session browser). This is the surface most people mean when they say "the TUI" — it is what a human actually runs and looks at day to day, and it is where LLM output ends up rendered to a human (this is the process that showed raw JSON tool-call text as a plain assistant message when `provider-ollama` failed to emit structured `tool_calls`; that bug was mitigated upstream in `provider-ollama`, not here — see `packages/provider-ollama/src/messages.ts` / `client.ts`).

It is a completely different thing from `@yggdrasil/channel-tui` — see that package's README for the full comparison. Short version: `channel-tui` runs inside the gateway process and talks to its own stdin/stdout; `app-tui` is a separate process that talks to the gateway over WebSocket.

## Public API / How you run it

This package is an app, not a library consumed by other packages' source. Two entry points:

- **CLI binary** — `bin: yggdrasil-tui` → `dist/cli.js` (source: `src/cli.ts`, flags parsed in `src/parseArgs.ts`). Flags: `--connect <ws-url>` (default `ws://127.0.0.1:18789`), `--api-key <key>`, `--agent <id>`, `--continue` / `-c`; each also accepts the `--flag=value` form. Renders `<App>` with Ink.
- **Library entry** — `src/index.ts` exports `launchTui(options): Promise<(() => void) | undefined>` (`src/launch.ts`). Renders the same `<App>` and returns an `unmount` callback once the Ink app exits. This is how `packages/cli/src/index.ts` embeds it (`await import("@yggdrasil/app-tui")` inside `cmdTui()`), rather than shelling out to the `yggdrasil-tui` binary.

In practice you run it via `yggdrasil tui` (from `@yggdrasil/cli`), not directly.

### Code shape (for orientation, not exhaustive)

- `src/client/gateway-client.ts` — `GatewayClient`, an `EventEmitter` wrapping a `ws` WebSocket connection to the gateway. `connect()`/`disconnect()`, auto-reconnect with a 2s backoff, `call(method, params, timeoutMs)` for request/response RPC (`{ id, method, params }` → matched by `id`), and emits typed events (`chat.delta`, `chat.final`, `turn.start`, `turn.end`, `tool.execute`, `tool.approval.requested`, `tool.approval.resolved`, `connected`, `disconnected`, `error`) for anything the gateway pushes as `{ type: "event", event, payload }`.
- `src/client/types.ts` — payload/type definitions for the above.
- `src/state/store.ts` — `TuiState`, `TuiAction` union, and `tuiReducer` — a single `useReducer` state machine driving the whole app (messages, streaming buffer, active view, agents/providers list, pending tool approval, session list, config, input history, scroll offset).
- `src/hooks/useGatewayEvents.ts` — subscribes a `GatewayClient` to the reducer, filtering events by the current `sessionKey`.
- `src/hooks/useKeybinds.ts` — global key handling (Ctrl+C to exit, Ctrl+K to toggle the command palette, Escape to pop the current view, PageUp/PageDown or Shift+Arrow to scroll).
- `src/hooks/useTerminalSize.ts` — tracks terminal columns/rows for layout and markdown wrap width.
- `src/components/App.tsx` — the root component: owns the `GatewayClient` instance, does the initial handshake (`agents.list`, `providers.list`, `config.get`, optionally resuming a session via `sessions.list`/`sessions.get` when `--continue` is passed), builds the `CommandContext` the slash commands run against, and switches between view modes (`chat`, `config`, `sessions`, `agents`, `tools`, `turns`, `command-palette`).
- `src/commands/` — the slash-command registry (see "Extending" below).
- `src/components/` — `MessageList`, `MessageItem`, `StreamingMessage`, `ToolCallView`, `InputBox`, `StatusBar`, `ApprovalPrompt`, `CommandPalette`, `SlashAutocomplete`, `SessionList`, and `config/` (`ConfigMenu`, `ProviderMenu`, `ModelMenu`, `ApiKeyForm`) for the settings UI.
- `src/render/` — `markdown.ts` (marked + marked-terminal), `highlight.ts` (cli-highlight), `diff.ts`, `theme.ts` (color palette).

### Cancelling a turn

`Esc` (chat view) or `Ctrl+C` while a turn is running calls the gateway's `chat.cancel` for the session. The turn stops as soon as practical: no further model or tool call starts, a pending approval prompt counts as denied, and the text streamed so far is kept, ending in `(cancelled)`. With nothing running, `Ctrl+C` quits as before. The cancel is cooperative (see `HarnessAttemptParams.signal` in `@yggdrasil/sdk`): a tool call that is already executing runs to completion.

### Authentication and reconnects

If the gateway requires an API key, pass `--api-key <key>` or set `YGGDRASIL_API_KEY`; the key is sent with the `auth` RPC on every (re)connect. A rejected key stops the retries instead of looping. `GatewayClient` rejects in-flight calls the moment the socket drops (`ConnectionLostError`) and emits `reconnected` when it is back; the app then reloads the session from the gateway (`sessions.get`) and re-sends the approval mode, since deltas and the final reply emitted while disconnected are not replayed.

### Slash commands (handled in `App.tsx`'s `handleSlashCommand`)

`/reset`, `/agent <id>`, `/agents`, `/sessions` (press `r` on a row to rename it), `/rename <title>`, `/tools` (every tool the agent can call, with kind, risk level and parameters), `/turns` (the gateway's recent turns, newest first), `/config`, `/model`, `/compact`, `/export`, `/new`, `/status`, `/help`, `/exit` (`/quit`).

The status bar shows the project folder, the active agent with its model, and the session's title once it has one. Input history (↑/↓) is saved to `~/.yggdrasil/tui-history.json` (last 500 entries) and restored on the next start.

### Session key format

`buildSessionKey("tui", "default", "<senderIdPrefix>-<uuid>")` — `senderIdPrefix` is a hash of the workspace root (`workspaceSenderPrefix` in `packages/cli/src/index.ts`), so `--continue` can find "the most recent TUI session for this path" via `sessions.list`.

## Depends on

- `@yggdrasil/config` — `buildSessionKey`.
- `@yggdrasil/sdk` — plugin/type surface shared across the codebase (mostly types here).
- `ink` 8, `react` 19 (same React as the desktop app), `ink-spinner`, `ink-text-input` — the terminal UI framework.
- `ws` — WebSocket client.
- `marked`, `marked-terminal`, `cli-highlight` — markdown/code rendering in the terminal.
- `fuzzysort` — fuzzy matching for the command palette / slash autocomplete.

## Used by

- `packages/cli/src/index.ts` — dynamically imports `@yggdrasil/app-tui` inside `cmdTui()` for the default `yggdrasil tui` path (both the "attach to an already-running gateway" branch and the "spawn a gateway then launch" branch).

Nothing else in the workspace depends on it — it's a leaf application.

## Configuration

Reads no config file directly. It receives its gateway URL and session behavior as constructor/CLI options (`gatewayUrl`, `senderIdPrefix`, `continueSession`); the actual `yggdrasil.config.json` (agents, providers, harness policy) is fetched over the wire via `config.get`, `agents.list`, `providers.list` RPC calls once connected, and edited through the `ConfigMenu` UI via `config.patch`.

## Extending / what's safe to change

- **New slash command**: add a `SlashCommand` (`name`, `description`, `run(ctx, args)`, optional `aliases`, `usage`, `noPalette`) to one of the modules in `src/commands/` (`session.ts`, `agent.ts`, `info.ts`) or to `SLASH_COMMANDS` in `commands/index.ts`. `/help`, the command palette and the slash autocomplete are generated from that list; `ctx` gives the gateway client, the state and `dispatch`. Cover it in `commands/commands.test.ts` with the fake context from `makeCtx`.
- **New component**: drop it under `src/components/`, wire it into `App.tsx`'s render tree under the relevant `state.viewMode` branch. Follow the existing pattern of pure presentational components fed by `state`/`dispatch` from the reducer rather than owning their own gateway calls, except where a component (like `ConfigMenu`) explicitly needs `client` for its own RPCs.
- **New gateway event**: add the payload type to `client/types.ts`, add it to `GatewayClientEvents` in `gateway-client.ts`, subscribe in `useGatewayEvents.ts`, and add a `TuiAction` + reducer case in `state/store.ts`.
- **Rendering tweaks** (markdown, syntax highlighting, diffs, color theme) live entirely in `src/render/` and are self-contained — safe to iterate on without touching state/client code.
- Tests: the reducer (`state/store*.test.ts`), render helpers, `GatewayClient` against a real `ws` server (`client/gateway-client.test.ts`: response routing, connection loss, reconnect, auth), the keybinds hook and `StatusBar` via `ink-testing-library` (written as `.test.ts` with `React.createElement`, since the root vitest config only picks up `.test.ts`). End-to-end cancellation is covered in `test/e2e/chat-cancel.test.ts`; `src/app.e2e.test.ts` mounts the whole `<App>` against a real test gateway (chat round trip, `/turns`, `/tools`) and is excluded from `tsc` because it imports the repo-level test helpers.
