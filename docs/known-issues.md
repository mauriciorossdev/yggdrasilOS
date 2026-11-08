# Known issues

Infra/build gotchas that aren't feature work — not tracked in `roadmap.md`.

## `pnpm desktop` fails with `Error: Electron uninstall`

**Symptom:** the app-desktop build finishes, then electron-vite throws
`Error: Electron uninstall` before opening a window.

**Root cause:** the `electron` package has no `postinstall`. Its binary is
downloaded only by its `install-electron` bin, or lazily the first time
something calls `require("electron")`. electron-vite doesn't do either: it reads
`node_modules/electron/path.txt`, which doesn't exist until the binary is there.
So a fresh `pnpm install` leaves nothing to start, even with `electron` in
`onlyBuiltDependencies`.

**Fix:** `packages/app-desktop`'s `postinstall` runs `install-electron` before
rebuilding `better-sqlite3`. To repair an existing checkout by hand:
`pnpm --filter @yggdrasil/app-desktop run postinstall`.

## `pnpm i` fails with ENOENT on `@istanbuljs\schema`

**Symptom:** `electron-builder install-app-deps` (app-desktop's `postinstall`
at the time) died with
`ENOENT: no such file or directory, stat '...\node_modules\.pnpm\node_modules\@istanbuljs\schema'`.

**Root cause:** a dangling junction left in pnpm's hoisted folder by an older
`@vitest/coverage-v8`. The lockfile no longer references it, so `pnpm i` says
"Already up to date" and never cleans it, but electron-builder stats it. Only
checkouts installed before that upgrade have it, and only tools that walk the
hoisted folder trip on it.

**Fix:** delete the stale junction and reinstall:

```powershell
Remove-Item node_modules\.pnpm\node_modules\@istanbuljs -Recurse -Force
pnpm i
```

If other junctions are broken, remove `node_modules` entirely and run `pnpm i`.

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
