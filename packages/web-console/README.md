# @yggdrasil/web-console

## Purpose

A browser-based admin/chat console for the gateway — a lighter, read/write alternative to `app-tui` that runs in a normal web browser instead of a terminal. Four pages: **Overview** (health, plugins, harnesses, providers, channel status — all read-only dumps), **Chat** (a single hardcoded session, `web:default:user`, send a message and watch it stream in), **Sessions** (list/inspect/rename/reset saved sessions), **Settings** (edit default agent/provider/model, harness policy, and per-channel enabled flags, then `config.patch`).

It is the build-system exception in this monorepo: everything else is `tsc`-built and `@yggdrasil/*`-scoped as a workspace library; this package is Vite + React (private, unpublished, no `@yggdrasil/` consumers), and its production build isn't served from its own package — it's physically copied into `packages/gateway/ui` and served by the gateway's HTTP server at `/ui`.

## Public API / How you run it

Not a library — a browser app with no package exports.

- **Dev**: `pnpm --filter @yggdrasil/web-console dev` → Vite dev server on port `5173`, proxying `/ws` to `ws://127.0.0.1:18789` (see `vite.config.ts`) so you can develop the UI against a locally running gateway without a CORS/mixed-origin dance.
- **Build**: `vite build` (outputs to `dist/`, `base: "/ui/"`) followed by a `postbuild` script, `scripts/copy-to-gateway.mjs`, which deletes `packages/gateway/ui` and copies `dist/` there. After this, the gateway serves the console itself — visiting `http://<gateway-host>:<port>/ui` in a browser is "running" it in production.
- **Entry point**: `src/main.tsx` mounts `<App />` (`src/App.tsx`) into `#root`. `App` wraps everything in `GatewayProvider` (`@yggdrasil/client-web`) and a `BrowserRouter basename="/ui"`, boots the gateway connection on mount, and gates all routes behind `<AuthGate>` (`src/components/AuthGate.tsx`) until authenticated (or until `health.authRequired` is false).
- **Gateway client** (`@yggdrasil/client-web`, extracted from this package so `app-desktop` can share it): `GatewayClient` — a small browser-native WebSocket wrapper (uses the global `WebSocket`, not `ws`) with the same request/response + event-frame protocol as `app-tui`'s client: `call(method, params, { collectEvents, timeoutMs })` returns `{ result, events }`, `onEvent(handler)` subscribes to pushed `{ type: "event" }` frames. `defaultWsUrl()` derives `ws(s)://<current host>` so it connects back to whatever origin served the page (the gateway itself in production, or the Vite proxy target in dev) — this package doesn't pass a `wsUrl` override to `GatewayProvider`, so it always gets this default. `auth(apiKey)` calls the `auth` RPC method and the key is cached in `sessionStorage` under `API_KEY_STORAGE` (`"yggdrasil.apiKey"`).
- **`useGateway()`** (`@yggdrasil/client-web`): React context hook exposing `{ connected, authenticated, health, connect, call, callWithEvents, onEvent, disconnect }` to every page component.
- **Pages** (`src/pages/`): `Overview.tsx`, `Chat.tsx`, `Sessions.tsx`, `Settings.tsx` — each calls the gateway directly via `useGateway()`, no shared data layer beyond that.
- **`Layout.tsx`**: sidebar nav (Overview / Chat / Sessions / Settings) + a disconnect button, wraps all routed pages via `<Outlet />`.

## Depends on

- `@yggdrasil/client-web` — the gateway WebSocket client + `useGateway()` hook, shared with `app-desktop`.
- `react`, `react-dom`, `react-router-dom` (v7) — runtime.
- `vite`, `@vitejs/plugin-react`, `typescript` — dev/build tooling.

## Used by

Nothing imports it as a package. Its build output is consumed by `packages/gateway` (copied into `packages/gateway/ui`, served statically — see `tryServeUi` in `packages/gateway/src/static-ui.ts`, referenced from `packages/gateway/src/server.ts`). If you `pnpm build` the whole workspace, this is the one package where "build" also has a side effect on a sibling package's source tree.

## Configuration

No config file of its own. Auth is driven by the gateway's `auth.gateway` config / `YGGDRASIL_API_KEY` (same as everything else that talks to the gateway's WS API) — the console just prompts for whatever key the gateway's `health` RPC response says is required (`authRequired: true`) and holds it in `sessionStorage` for the tab's lifetime.

## Extending / what's safe to change

- **New page**: add a component under `src/pages/`, register a `<Route>` in `App.tsx`'s `<Routes>`, add a `<NavLink>` in `Layout.tsx`. Follow the existing pages' pattern: pull `call`/`callWithEvents`/`onEvent` from `useGateway()`, don't build a separate client.
- **New gateway RPC method usage**: just call `call("method.name", params)` from a page — there's no method registry or type-safe RPC layer, params/results are typed ad hoc per call site (see the local `Health`, `SessionSummary`, `ConfigShape` types scattered across page files). If a method's payload shape changes on the gateway side, you have to update these by hand.
- **Changing `GatewayClient`/`useGateway()` itself** happens in `@yggdrasil/client-web`, not here — this package only consumes it. `app-desktop` consumes the same code, so a fix here fixes both.
- **Chat page is single-session by design** (`SESSION_KEY = "web:default:user"` in `Chat.tsx`) — there's no session switcher on that page; use the Sessions page to inspect other sessions, or extend `Chat.tsx` to accept a session key via route param if you want multi-session chat here.
- Remember the `postbuild` step: if you change anything in `src/`, you need to run `pnpm --filter @yggdrasil/web-console build` (or the workspace-wide `pnpm build`) for the change to show up at `/ui` on a running gateway — editing files alone doesn't affect `packages/gateway/ui` until the copy script runs.
- `vite.config.ts`'s dev proxy rewrites `/ws` → `/` against `ws://127.0.0.1:18789`; if the gateway's default port changes, update it there too for `pnpm dev` to keep working.
