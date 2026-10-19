# @yggdrasil/channel-http

## Purpose

A gateway channel plugin that exposes a single inbound HTTP webhook endpoint. Any external system (curl, a webhook sender, a bot framework) can POST a message to it and get the agent's reply back, either as one JSON response or as a Server-Sent Events stream. It is one of two "built-in" channels shipped in this repo (the other is `channel-tui`); both plug into the gateway's channel-plugin system rather than being loaded as library dependencies.

## Public API

Everything is exported from `src/index.ts`:

- `httpChannel: ChannelPlugin` (`packages/channel-http/src/channel.ts`) — the channel implementation itself: `id: "http"`, capabilities `{ inbound: true, outbound: true, streaming: true }`.
  - `gateway.startAccount(ctx)` — starts a `node:http` server on `ctx.config.port` (default `18790`) / `ctx.config.host` (default `127.0.0.1`) for the given account. One server per accountId, tracked in a module-level `Map`.
  - `gateway.stopAccount(ctx)` — closes that account's server.
  - `outbound.sendBlock` / `outbound.sendFinal` — resolve the pending HTTP/SSE response for the request that triggered the turn.
- `httpChannelPlugin` (default export) — the `definePlugin(...)` wrapper (`id: "channel-http"`) that calls `api.registerChannel(httpChannel)`. This is what the plugin loader actually imports.
- `HttpAccountConfig` type — `{ port?, host?, token? }`, the shape of one entry under `channels.http.accounts.<id>` in `yggdrasil.config.json`.

### Wire protocol

`POST /inbound` (only route that exists; anything else 404s):

```
POST /inbound
Authorization: Bearer <token>        # only if an API key is configured
Content-Type: application/json
Accept: text/event-stream            # optional, switches to SSE

{ "message": "...", "senderId"?: "...", "sessionKey"?: "..." }
```

- Without `Accept: text/event-stream`: waits (up to 30s) for the full reply, responds `{ reply, sessionKey }`.
- With it: streams `event: delta` frames as the model produces text, then one `event: final` frame with `{ reply, sessionKey }`, and closes the connection.
- If `sessionKey` is omitted, one is derived via `buildSessionKey("http", accountId, senderId)` (from `@yggdrasil/config`), so repeated calls from the same `senderId` continue the same conversation.

## Depends on

- `@yggdrasil/config` — `buildSessionKey`, `resolveHttpApiKey`, `validateApiKey`, `parseBearerToken`, `YggdrasilConfig` type.
- `@yggdrasil/sdk` — `definePlugin` and the `ChannelPlugin` / `ChannelGatewayStartContext` / `NormalizedInboundMessage` / `OutboundContext` types that every channel plugin implements against.

## Used by

Nothing imports `@yggdrasil/channel-http` as a package dependency — no `packages/*/package.json` references it. It is loaded dynamically at runtime by the gateway's plugin loader (via `plugins.load` / `discoverNodeModules` in `yggdrasil.config.json`, matched against its `yggdrasil.plugin.json` manifest). `yggdrasil run` (in `packages/cli/src/index.ts`) is the CLI command that enables it by default (`channels.http.enabled: true`, port `18790`).

## Configuration

Root `yggdrasil.config.json`:

```json
{
  "channels": {
    "http": {
      "enabled": true,
      "accounts": {
        "default": { "port": 18790, "host": "127.0.0.1", "token": "..." }
      }
    }
  },
  "auth": {
    "http": { "apiKey": "..." },
    "gateway": { "apiKey": "..." }
  }
}
```

Auth resolution order (`resolveHttpApiKey` in `@yggdrasil/config`): `auth.http.apiKey` → `YGGDRASIL_API_KEY` env var / `auth.gateway.apiKey` → per-account `channels.http.accounts.<id>.token`. If none are set, the endpoint is open (no `Authorization` header required).

## Extending / what's safe to change

- This is a single-route webhook, not a router — there's no framework here, just a raw `node:http` `createServer` callback in `channel.ts`. To add a new route (e.g. `/health` or a second endpoint), extend the `if (req.method !== "POST" || req.url !== "/inbound")` check into a small dispatcher; keep the 404 fallback for unknown paths.
- The reply timeout is hardcoded to `30_000` ms (`Promise.race` in the request handler) — bump it there if you need longer-running turns.
- `pendingReplies` is an in-memory `Map` keyed by `sessionKey`; a second concurrent request on the same `sessionKey` will clobber the first one's pending promise. If you need per-request (not per-session) correlation, key it by a request id instead.
- Each account gets its own `http.Server` — adding a new account just means adding an entry under `channels.http.accounts` with a different `port`; no code change needed.
- Follow `channel-tui`'s `channel.ts` as the other reference implementation of the same `ChannelPlugin` interface if you want to see a non-HTTP example side by side.
