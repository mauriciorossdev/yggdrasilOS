# Known issues

Infra/build gotchas that aren't feature work — not tracked in `roadmap.md`.

## `better-sqlite3` ABI flips between Node and Electron (TODO: permanent fix)

**Symptom:** `context-memory-db` fails to load with:

```
The module '.../better-sqlite3/build/Release/better_sqlite3.node'
was compiled against a different Node.js version using
NODE_MODULE_VERSION 130. This version of Node.js requires
NODE_MODULE_VERSION 127.
```

Breaks long-term memory silently for `yggdrasil tui` / `yggdrasil run` (plain
Node, ABI 127 on Node 22) every time it follows an `app-desktop` install.

**Root cause:** `better-sqlite3` is a native addon, and pnpm stores one
physical build per package+version in its content-addressable store, shared
via symlinks across every workspace consumer. `packages/app-desktop` depends
on `@yggdrasil/context-memory-db` (→ `better-sqlite3`) directly and runs

```
"postinstall": "electron-builder install-app-deps"
```

(`packages/app-desktop/package.json`), which rebuilds native deps against
Electron's bundled Node ABI (130 here) — mutating that single shared store
copy. The CLI/TUI, running under plain system Node (ABI 127), then can't
load it until someone manually rebuilds it back
(`cd node_modules/.pnpm/better-sqlite3@<ver>/node_modules/better-sqlite3 &&
npm run build-release`) — which in turn breaks Electron again. Two consumers
of one workspace dependency need two different native builds; pnpm's dedup
model can't hold both at once.

**Interim workaround:** rebuild for whichever runtime you're about to use
(see command above). Not durable — the next `pnpm install` (or opening
`app-desktop`) flips it back.

**TODO — permanent fix, one of:**
- Give `app-desktop` its own non-hoisted copy of `better-sqlite3` (e.g.
  `pnpm.overrides` / patched dependency scoped to that package only, or
  isolate it via `node-linker=isolated` semantics for this one dep) so the
  Electron rebuild stops mutating the copy the CLI/TUI resolve to.
- Or: don't run `electron-builder install-app-deps` from a workspace-wide
  postinstall — scope the native rebuild to `app-desktop`'s own dependency
  tree (`electron-builder install-app-deps` supports `--dir`), or move it to
  `predist`/`dist` instead of `postinstall` so a plain `pnpm install` at the
  repo root never triggers it.
- Or: swap `better-sqlite3` for a WASM/pure-JS sqlite build in
  `context-memory-db` so there's no native ABI to reconcile at all.

Whoever picks this up: verify against both `pnpm yggdrasil tui` (system
Node) and `pnpm desktop` (Electron) after the fix — this bug only shows up
when both are exercised, which is easy to miss testing just one.
