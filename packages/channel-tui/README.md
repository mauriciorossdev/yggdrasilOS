# @yggdrasil/channel-tui

## Purpose

A gateway channel plugin that turns the gateway process's *own* stdin/stdout into a minimal, line-based chat prompt (`node:readline`, no Ink, no colors beyond a couple of arrows). It runs **inside the gateway process** — there is no separate client process, no WebSocket, nothing to connect to. This is the "legacy" / zero-dependency terminal mode.

**This is not the TUI most users run.** See "channel-tui vs app-tui" below — `@yggdrasil/app-tui` (a full React/Ink application that connects to the gateway over WebSocket) is the rich interactive client people actually use day to day. `channel-tui` only comes into play for `yggdrasil run` and `yggdrasil tui --legacy`.

## Public API

Exported from `src/index.ts`:

- `tuiChannel: ChannelPlugin` (`src/channel.ts`) — `id: "tui"`, capabilities `{ inbound: true, outbound: true, streaming: true, interactive: true }`.
  - `gateway.startAccount(ctx)` — opens a `readline.Interface` on `process.stdin`/`process.stdout` with prompt `"yggdrasil> "`. Handles typed lines directly: plain text becomes an inbound message; `/reset` clears the session via `getSessionStore()`; `/agent <id>` switches the active agent for this session; `/exit` / `/quit` aborts the channel.
  - `gateway.stopAccount(ctx)` — closes the readline interface.
  - `outbound.sendText` / `sendBlock` / `sendFinal` — print to stdout; streaming deltas overwrite the same terminal lines in place using ANSI cursor-up + clear-line escapes (`clearStreamingDisplay`/`renderStreaming`/`finishStreaming` in `channel.ts`).
- `createTuiApprovalPrompt(): (toolName, args) => Promise<boolean>` — returns a function that prints `⚠ Approve tool <name> with <args>? [y/N]` to stdout and resolves from the next line typed into the *same* readline session (60s timeout → denied). Used by `packages/cli/src/index.ts` (`buildApprovalHandler`) to wire y/n tool approval into this same stdin/stdout when this channel is the active interactive surface.
- `tuiPlugin` (default export) — `definePlugin({ id: "tui", ... })` wrapper that calls `api.registerChannel(tuiChannel)`.

## Depends on

- `@yggdrasil/config` — `buildSessionKey`.
- `@yggdrasil/sdk` — `definePlugin`, `ChannelPlugin` and related context/message types.
- `@yggdrasil/sessions` — `getSessionStore()`, used to implement `/reset`.

## Used by

- `packages/cli/src/index.ts` imports `createTuiApprovalPrompt` directly (not just as a loaded plugin) to build the approval handler for `yggdrasil run` and `yggdrasil tui --legacy`.
- Loaded dynamically as a channel plugin by the gateway whenever `channels.tui.enabled` is `true` in config (same mechanism as `channel-http`) — see its `yggdrasil.plugin.json` manifest.

## channel-tui vs app-tui

These are two independent, unrelated implementations of "chat in a terminal" that happen to share the word "tui":

| | `channel-tui` | `app-tui` |
|---|---|---|
| What it is | A `ChannelPlugin`, loaded into the **gateway process** | A standalone Node/Ink executable (`bin: yggdrasil-tui`), a **separate process** |
| Transport | None — reads/writes the gateway's own `process.stdin`/`stdout` directly | WebSocket RPC client, connects to `ws://<host>:<port>` (the gateway's built-in WS server in `packages/gateway/src/server.ts`) |
| UI | Plain `readline` prompt, arrow-prefixed lines | Full Ink component tree: markdown rendering, syntax highlighting, tool-call cards, approval prompts, command palette, config menu, session browser |
| Reached via | `yggdrasil run`, `yggdrasil tui --legacy` | `yggdrasil tui` (default path) |
| Session prefix | `tui:<accountId>:...` via `buildSessionKey("tui", ...)` | Also `tui:default:...` — same prefix, different process |

Concretely, in `packages/cli/src/index.ts`: `cmdTui()` first checks if a gateway is already listening (`probeGateway`); if so (or once it starts one with **both channels disabled**: `tui: { enabled: false }, http: { enabled: false }`), it dynamically imports `@yggdrasil/app-tui` and calls `launchTui({ gatewayUrl })`. Only the `--legacy` flag routes to `cmdTuiLegacy()`, which enables the `channel-tui` plugin instead. The two never run against each other — a session started in one is not visible live to the other, though both read/write the same on-disk session store format from `@yggdrasil/sessions`.

## Configuration

```json
{
  "channels": {
    "tui": { "enabled": true }
  }
}
```

Only `enabled` is read; there is no per-account config (`config.listAccountIds()` always returns `["default"]`).

## Extending / what's safe to change

- The command parser (`/reset`, `/agent`, `/exit`) is a chain of `if (body === ...)` checks in the `rl.on("line", ...)` handler in `channel.ts` — add new slash commands there, before the fallback path that builds a `NormalizedInboundMessage`.
- Streaming render state (`streamingActive`, `streamingBuffer`, `lastStreamKey`, etc.) is module-level, not per-session — this channel assumes a single interactive session at a time (`[...sessions.values()][0]` in `createTuiApprovalPrompt`). Don't reuse this pattern if you need multi-session concurrency; look at `channel-http`'s per-account `Map` instead.
- If you're tempted to add rich formatting here, don't — that's what `app-tui` is for. Keep this channel dependency-free and simple; its value is having zero extra process/protocol to run.
