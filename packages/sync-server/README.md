# @yggdrasil/sync-server

Standalone HTTP service that lets 1-5 trusted people share a specific resource
(a plugin's storage key — e.g. a kanban board — or a `notes/` file) with each
other, asynchronously. No live push channel, no accounts: just an owner key,
short-lived invite codes, and per-share member keys.

Deliberately has **zero `@yggdrasil/*` workspace dependencies** — it can be
deployed on its own without the rest of the monorepo's build graph.

## Local dev

```
npm install
npm run build
npm start          # listens on :8787, writes ./data/sync.db
```

## Deploying to Railway

1. New Railway project → Deploy from GitHub repo → pick this repo.
2. In the service's Settings → **Root Directory**: `packages/sync-server`.
   (Railway still checks out the whole repo; this just changes the working
   directory build/start commands run from — `railway.json`'s `npm install`
   only installs this package's own deps, no pnpm workspace resolution
   needed.)
3. Add a **Volume**, mount path e.g. `/data`.
4. Set env var `SYNC_DB_PATH=/data/sync.db`.
5. Deploy. Railway sets `PORT` automatically; the server reads it.
6. Grab the generated public URL — that's the `serverUrl` you paste into the
   desktop app's sync settings.

## API

All authenticated routes take `Authorization: Bearer <apiKey>`.

- `POST /v1/shares` `{resourceType, resourceKey, initialContent, ownerName}` → `{shareId, version}` — presenting key becomes the share's owner.
- `POST /v1/shares/:id/invites` `{role: "edit"|"view", expiresInHours?}` → `{code}` — owner only.
- `POST /v1/invites/:code/redeem` `{memberName}` → `{shareId, resourceType, resourceKey, apiKey, role}` — apiKey is shown once.
- `GET /v1/shares/:id` → `{content, version, role}`.
- `PUT /v1/shares/:id` `{content, expectedVersion}` → `{version}` on success, `409 {currentVersion, currentContent}` on stale write.
- `GET /v1/shares/mine` → `[{id, resourceType, resourceKey, role, version, memberCount}]`.
- `DELETE /v1/shares/:id/members/:keyHash` → `204` — owner only.
- `POST /v1/shares/:id/web-links` `{email, role}` → `{url, keyHash}` — owner only. Browser link for someone without the desktop app; the key rides in the URL fragment.
- `GET /v1/shares/:id/members` → `[{keyHash, name, email, role, kind: "app"|"web", invitedAt}]` — owner only.
- `POST /v1/shares/:id/verify-email` `{email}` → `{ok, resourceType, role}` — with a web-link key.
- `PUT /v1/shares/:id/bundle` `{files, project, pluginId, pluginName, storageKey}` → `204` — owner only, plugin shares only. The plugin's own static files, so the browser page can run it.

### Web links (people without Yggdrasil)

`GET /w/:id` serves a page that asks for the visitor's email, then shows a
notes file (markdown editor) or runs the shared plugin (`/w/:id/app/*`, with
`/w/:id/ygg-web.js` standing in for the desktop `window.ygg` SDK). Web-link
members must send `X-Share-Email` (URI-encoded) matching the email the link was
created for on every `GET`/`PUT /v1/shares/:id` — 401 `email_required`, 403
`email_mismatch`, 429 after 5 failed attempts (15 min lock, per link, in
memory). Owner and desktop members don't need it.

Set `PUBLIC_URL` (e.g. `https://your-app.up.railway.app`) so generated links
use it; otherwise the request's host is used.

`content` is an opaque string — the client decides what's inside it (a
JSON-serialized kanban board, raw notes-file text, etc).
