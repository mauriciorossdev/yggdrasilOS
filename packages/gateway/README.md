# @yggdrasil/gateway

## Purpose

The gateway is the long-running process every channel and every UI client talks to. It hosts an HTTP
server (serving a small JSON status page and, under `/ui`, the built `web-console` static assets) with a
WebSocket server layered on top for a JSON-RPC-style request/response + event-push protocol. It owns
starting/stopping channel accounts (TUI, HTTP, Telegram, etc. — whatever `@yggdrasil/kernel` has
registered), exposes a set of built-in RPC methods (`chat.send`, `sessions.*`, `config.get`/`patch`,
`agents.list`, `providers.list`, `tools.*`, `plugins.list`, `health`, …) plus any custom methods a plugin
registers via `registerGatewayMethod`, and enforces API-key auth on both the WebSocket connection and
implicitly on the HTTP channel. Default bind address is `127.0.0.1:18789` (from
`DEFAULT_CONFIG.gateway` in `@yggdrasil/config`, overridable via `config.gateway.port`/`host`). This is the
package `packages/cli`'s `run`/`gateway`/`tui` commands actually start.

## Public API

`packages/gateway/src/index.ts` re-exports from `server.ts`, `channel-manager.ts`, `methods.ts`.

**server.ts**
- `startGatewayServer(options: GatewayServerOptions): Promise<GatewayServer>` — the main entry point.
  Creates an HTTP server (serving `/ui` static files via `tryServeUi`, else a JSON `{ok, service, ui}`
  status blob), wraps it with a `WebSocketServer`, wires WebSocket connections to auth-check + dispatch via
  `handleGatewayRequest`, subscribes each connection to the event bus (`chat.final`, `chat.delta`,
  `tool.approval.requested/resolved`, `turn.start/end`, `tool.execute`, `provider.latency` — pushed as
  `{type:"event", event, payload}`), starts a `ChannelManager`, and (unless `startChannels:false`) starts
  all enabled channel accounts. Returns a `GatewayServer` (`{httpServer, wss, channelManager, context, port,
  close()}`).
- `invokeGatewayMethod(method, params, config, sessionStore?, workspaceRoot?)` — calls a gateway method
  in-process without a WebSocket round trip (used by CLI/test code that wants to hit `chat.send` etc.
  directly); throws if the method returns an error response.
- Types: `GatewayServerOptions` (`config`, `workspaceRoot?`, `startChannels?`, `approveTool?`), `GatewayServer`.

**channel-manager.ts**
- `ChannelManager` — class managing the running/stopped state of `channelId:accountId` pairs.
  - `startChannel(channelId, accountId?)` — looks up the `ChannelPlugin` via `listChannels()`, calls its
    `gateway.startAccount` with an `onInbound` callback that runs `ingestInboundMessage` +
    `runChannelTurn` (from `@yggdrasil/pipeline`) and streams deltas back through `outbound.sendBlock`.
  - `stopChannel(channelId, accountId?)` — aborts the account's `AbortController` and calls `gateway.stopAccount`.
  - `startAllEnabled()` — starts every channel not explicitly disabled (`config.channels[id].enabled !== false`)
    across all of its configured account ids.
  - `stopAll()` / `status()` / `getChannelPlugin(channelId)`.
  - Type: `ChannelManagerOptions`.

**methods.ts**
- `handleGatewayRequest(request: GatewayRequest, ctx: GatewayContext): Promise<GatewayResponse>` — the RPC
  dispatcher: checks plugin-registered methods first (`getRegistry().gatewayMethods`), then built-in
  `coreMethods`, else returns `METHOD_NOT_FOUND`. Lazily registers all built-in methods on first call.
- `createDefaultGatewayContext(config, sessionStore?, workspaceRoot?): GatewayContext` — builds
  `{config, workspaceRoot, events: createEventBus(), logger, sessionStore}`.
- `registerCoreMethod(name, handler)` — how the built-in methods themselves are registered; also usable to
  add first-class methods without going through the plugin system.
- Built-in methods registered by `registerBuiltinMethods()` (not directly exported, but this is the
  authoritative list of what the gateway can do): `health`, `plugins.list`, `agents.list`,
  `harnesses.list`, `providers.list`, `channels.status`, `channels.start`, `channels.stop`,
  `sessions.list`, `sessions.get`, `sessions.patch`, `sessions.reset`, `sessions.compact`,
  `tools.approve`, `tools.list`, `chat.send`, `turns.recent`, `chat.subscribe`, `config.get`, `config.patch`.
- `createGatewayApprovalHandler(events)` — builds a `ToolApprovalHandler` that emits
  `tool.approval.requested` and waits (60s timeout, default-deny) for a matching `tools.approve` RPC call
  to emit `tool.approval.resolved` and resolve the promise. This is how a UI client answers a
  "do you want to allow this destructive tool call?" prompt over the wire.
- Type: `GatewayContext`, `GatewayMethodHandler`.

Not re-exported from `index.ts` but present in `src/`: `auth.ts` (`isWsAuthenticatedByDefault`,
`tryAuthenticateFromQuery`, `tryAuthenticateFromRequest` — WebSocket-connection-level auth, checked in
`server.ts`), `static-ui.ts` (`resolveUiRoot`, `tryServeUi` — serves the `web-console` build copied into
`packages/gateway/ui` at build time, honoring `YGGDRASIL_UI_DIR` env override), `turn-log.ts`
(`pushTurnLog`, `getTurnLogSnapshot`, `clearTurnLog` — an in-memory ring buffer of the last 50 turns backing
the `turns.recent` RPC method).

## Depends on

- **`@yggdrasil/config`** — `YggdrasilConfig` type throughout; `isGatewayAuthRequired`, `resolveGatewayApiKey`,
  `validateApiKey` (auth.ts); `mergeConfig`, `readConfigFile`, `writeConfigFile`, `sanitizeConfigForClient`,
  `validateConfigPatch` (methods.ts, for `config.get`/`config.patch`); `buildSessionKey` (methods.ts, `chat.send`).
- **`@yggdrasil/kernel`** — `getRegistry` (plugin-registered gateway methods), `listChannels`, `listHarnesses`,
  `listPlugins`, `listProviders`, `createConsoleLogger`, `createEventBus`.
- **`@yggdrasil/pipeline`** — `ingestInboundMessage`, `runChannelTurn` (channel-manager.ts and methods.ts —
  this is the only thing that actually runs a chat turn), `compactSessionNow` (`sessions.compact`).
- **`@yggdrasil/sdk`** — `GatewayRequest`/`GatewayResponse`/`GatewayHandlerContext`, `ToolApprovalHandler`,
  `ChannelPlugin`, `EventBus`.
- **`@yggdrasil/sessions`** — `SessionStore` type, `getSessionStore()` (default context construction).
- **`@yggdrasil/tools-runtime`** — `listTools`, `resolveTools` (backing `tools.list`).
- **`ws`** — the actual WebSocket server implementation (`WebSocketServer`, `WebSocket`).

## Used by

- **`packages/cli/src/index.ts`** — `startGatewayServer` is called by the `run`, `gateway`, and `tui` CLI
  commands; this is the only in-repo importer. No other package imports `@yggdrasil/gateway` — channels and
  the web-console talk to it over HTTP/WebSocket at runtime, not via a TypeScript import.

## Configuration

- `gateway.host` / `gateway.port` — bind address, default `127.0.0.1:18789`.
- `auth.gateway.apiKey` / `auth.gateway.required` — via `isGatewayAuthRequired`/`resolveGatewayApiKey` from
  `@yggdrasil/config`; also `YGGDRASIL_API_KEY` env var. If a key is configured, WebSocket connections must
  send `{method:"auth", params:{apiKey}}` as their first message (or `?apiKey=` query param) before any
  other method succeeds.
- `channels[id].enabled` / `channels[id].accounts` — which channels `ChannelManager.startAllEnabled` starts
  and what account-level config (tokens, etc.) each account gets.
- Read/written wholesale by `config.get`/`config.patch` RPC methods (patch is restricted to the fields
  `@yggdrasil/config`'s `validateConfigPatch` allows: `agents`, `defaultAgent`, `harness`, `channels`).
- `YGGDRASIL_UI_DIR` env var — overrides where `static-ui.ts` looks for the built web console (defaults to
  `../ui` relative to the compiled `dist/static-ui.js`, i.e. `packages/gateway/ui`, populated by
  `web-console`'s `postbuild` copy script).

## Extending / what's safe to change

- **Adding a new RPC method**: prefer `registerGatewayMethod` from a plugin's `register(api)` over editing
  `registerBuiltinMethods()` in `methods.ts`, unless the method is genuinely core platform behavior (auth,
  session CRUD, config CRUD, chat dispatch). Plugin methods are checked first in `handleGatewayRequest`, so
  a plugin can also shadow a built-in method name — that's not currently guarded against, be careful with
  naming collisions.
- **The event names pushed over WebSocket are a de facto public protocol** — `web-console` and any external
  client rely on `chat.final`, `chat.delta`, `tool.approval.requested/resolved`, `turn.start/end`,
  `tool.execute`, `provider.latency` payload shapes. Changing a payload shape without a coordinated
  `web-console` update breaks the UI.
- **`config.patch`'s `requiresRestart: true`** in the response is informational only — the gateway does not
  actually restart itself; only `agents`/`defaultAgent`/`harness`/`channels` are hot-mergeable into the
  live `ctx.config`, and even then some consumers (e.g. anything that captured config at startup) won't see
  the change until an actual process restart.
- **Tool approval has a hardcoded 60s timeout and default-deny** (`APPROVAL_TIMEOUT_MS` in `methods.ts`,
  in-memory `pendingApprovals` map) — this state is process-local, so it does not survive a gateway restart
  and does not work across multiple gateway instances/load-balancing.
- **`static-ui.ts` path traversal guard** (`filePath.startsWith(normalize(uiRoot))`) — if you touch UI
  serving, keep this check; it's the only thing preventing `/ui/../../whatever` from escaping the `ui/` dir.
- Safe to change independently: `turn-log.ts`'s ring buffer size (`MAX_ENTRIES`), the JSON status blob
  served at `/` for non-`/ui` requests, and `createConsoleLogger` prefix strings.
