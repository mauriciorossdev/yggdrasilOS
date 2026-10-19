# @yggdrasil/context-memory-db

## Purpose

SQLite-backed (`better-sqlite3`) persistent memory store. It's two things bundled together:

1. A `ContextProvider` (`memory-db`) that injects the agent's stored memories as a `## Memories`
   system block on every turn.
2. A full plugin (`context-memory-db`) that also exposes gateway RPC methods
   (`memory.add`/`memory.list`/`memory.remove`/`memory.update`) so memories can be managed from
   outside the context-assembly path (e.g. a tool, a UI, or another plugin calling the gateway).

**Not currently wired into the running application** — see "Used by" below.

## Public API

`packages/context-memory-db/src/index.ts` exports:

- `memoryDbProvider: ContextProvider` — `id: "memory-db"`, `priority: 20`. `assemble(ctx)` opens
  the DB (`ctx.config.dbPath`, workspace-relative), queries memories for `ctx.agentId` (rows with
  matching `agent_id` or `agent_id IS NULL`, ordered by `relevance DESC, updated_at DESC`, limit
  20), and formats them as a bullet list (`- [type] content`). Returns `[]` if there are none.
  Cacheable, `ttlMs: 60_000`.
- `memoryDbPlugin` / `default` — a `YggdrasilPlugin` (id `"context-memory-db"`) whose `register(api)`:
  - calls `api.registerContextProvider(memoryDbProvider)`
  - registers gateway methods `memory.add`, `memory.list`, `memory.remove`, `memory.update` (each
    opens its own DB handle via `getMemoryDb`, reusing `api.config`/`api.globalConfig` to resolve
    `workspaceRoot` and `dbPath`)
  - registers a service (`id: "memory-db-cleanup"`) whose `stop()` calls `closeMemoryDb()`

`src/db.ts` (internal, not re-exported from the package root) implements the storage layer:
`getMemoryDb(workspaceRoot, dbPath?)`, `closeMemoryDb()`, `queryMemories`, `addMemory`,
`removeMemory`, `updateMemory`, `listAllMemories`, and the `MemoryRow` type
(`{ id, agent_id, content, type, created_at, updated_at, relevance }`).

Schema: single `memories` table, WAL journal mode, indexed on `agent_id`. Default file location is
`<workspaceRoot>/.yggdrasil/memory.db` (directory created if missing).

**Verified singleton caveat:** `getMemoryDb` caches the `Database` handle in a module-level `let
db` and returns it on every subsequent call **regardless of the `workspaceRoot`/`dbPath` arguments
passed in** — the first caller in the process wins. Fine for a single-workspace process; would
silently point every subsequent call at the wrong file in a multi-workspace process.

## Depends on

- `@yggdrasil/context-sdk` — `ContextProvider`, `ContextBlock`, `ContextProviderContext` types.
- `@yggdrasil/sdk` — `definePlugin`.
- `better-sqlite3` (runtime), `@types/better-sqlite3` (dev).

## Used by

Nothing in the current application wiring. Repo-wide search for `context-memory-db` finds only
this package's own `package.json`/`src` and the path alias in the root `vitest.config.ts` — it is
not in `packages/cli/src/index.ts`'s `bootstrapKernel({ bundledPlugins })` call, and it has no
`yggdrasil.plugin.json` manifest (compare with `extensions/echo-channel/yggdrasil.plugin.json`), so
the discovery-based plugin loader (`packages/kernel/src/plugin-loader.ts`) won't find it either.
It's a fully implemented package that currently isn't loaded by anything at runtime. There are also
no test files for it (unlike `context-runtime`, which has `cache.test.ts`/`resolve.test.ts`).

## Configuration

`ctx.config.dbPath` (string, optional) — path to the SQLite file, resolved relative to
`ctx.workspaceRoot`. Default: `.yggdrasil/memory.db`.

This is read both in `memoryDbProvider.assemble()` (via the shared `ContextProviderContext.config`)
and in the gateway method handlers (via `api.config`, which — unlike the provider path — is
correctly keyed by plugin ID `"context-memory-db"` per `plugin-loader.ts`). See
`@yggdrasil/context-runtime`'s README for the verified gap in how `ctx.config` reaches
`assemble()` for context providers specifically; the gateway-method config path does not have that
problem.

## Extending / what's safe to change

- To activate this plugin: give it a `yggdrasil.plugin.json` manifest and place it under a
  directory listed in `config.plugins.load.paths` (see `extensions/echo-channel` for the pattern),
  or add `memoryDbPlugin` to the `bundledPlugins` array where `bootstrapKernel(...)` is called in
  `packages/cli/src/index.ts`.
- To swap the storage backend (e.g. Postgres instead of SQLite), replace the internals of
  `src/db.ts` while keeping the `MemoryRow` shape and function signatures
  (`getMemoryDb`/`queryMemories`/`addMemory`/`removeMemory`/`updateMemory`/`listAllMemories`) so
  `index.ts` doesn't need to change. Alternatively, write a sibling package with its own
  `ContextProvider` (reuse the id `"memory-db"` to replace it outright, or use a new id to run both
  side by side) and its own `memory.*` gateway methods.
- The module-level singleton in `getMemoryDb` should be fixed (key the cache by `workspaceRoot`, or
  stop caching) before this is used in any multi-workspace or multi-tenant deployment.
