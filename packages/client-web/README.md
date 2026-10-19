# @yggdrasil/client-web

## Purpose

Browser-safe WebSocket client for the gateway's RPC/event-push protocol, plus a React context/hook (`GatewayProvider`/`useGateway`) wrapping it. Extracted out of `web-console` so a second browser-based client (`app-desktop`'s renderer) doesn't have to keep its own copy — this is the one place the wire protocol client code lives.

## Public API

- **`GatewayClient`** (`src/gateway-client.ts`) — thin wrapper around the global `WebSocket` (not `ws`, so it only runs in a browser/renderer context). `connect()`, `call(method, params, { collectEvents, timeoutMs })` → `{ result, events }`, `onEvent(handler)`, `auth(apiKey)`, `close()`.
- **`defaultWsUrl()`** — derives `ws(s)://<current page origin>`. Correct when the page is served *by* the gateway itself (`web-console`, at `/ui`). Wrong for any client loaded from a different origin — see below.
- **`API_KEY_STORAGE`** — the `sessionStorage` key both `GatewayClient` consumers use to cache the auth API key for the tab's lifetime.
- **`GatewayProvider`** / **`useGateway()`** (`src/useGateway.tsx`) — React context exposing `{ connected, authenticated, health, connect, call, callWithEvents, onEvent, disconnect }`. `GatewayProvider` takes an optional `wsUrl` prop; omit it to fall back to `defaultWsUrl()` (web-console's case), pass it explicitly for any client not served from the gateway's own origin (app-desktop's `file://`-loaded renderer — resolve the URL via its preload bridge first, then pass it down).

## Depends on

`react` (peer dependency, `^18.3.0 || ^19.0.0` — doesn't bundle its own copy).

## Used by

`@yggdrasil/web-console` (all pages, via `useGateway()`) and `@yggdrasil/app-desktop`'s renderer. Both own their own local `Health`/RPC-result types per call site — this package doesn't attempt a typed RPC method registry, same tradeoff `web-console`'s original client made.

## Extending / what's safe to change

- New RPC method usage: just call `call("method.name", params)` from a consuming component — no method registry here, params/results stay ad hoc per call site by design (matches the gateway's own untyped JSON-RPC-ish surface).
- If you add a second `wsUrl`-dependent behavior (e.g. reconnect-on-origin-change), keep it inside `GatewayProvider` so both consumers get it for free — that's the entire reason this package exists instead of two copies.
