# @yggdrasil/context-memory-local

## Purpose

Read-only context provider that pulls static Markdown "memory" notes off the local filesystem and
concatenates them into a system block. No database, no writes — it's the file-based counterpart to
`context-memory-db`. Sources, read in this order and joined with `---` separators:

1. `<workspaceRoot>/YGGDRASIL.md` (single project-level file, if present)
2. every `*.md` file directly inside `<workspaceRoot>/.yggdrasil/memory/` (sorted by filename)
3. every `*.md` file directly inside `~/.yggdrasil/memory/` (the user's home directory — global,
   cross-project notes)

Empty/whitespace-only files are skipped; missing directories are treated as empty (no error).

**Not currently wired into the running application** — see "Used by" below.

## Public API

`packages/context-memory-local/src/index.ts` exports:

- `memoryLocalProvider: ContextProvider` — `id: "memory-local"`, `priority: 10`. Returns `[]` if no
  source produced content; otherwise one block (cacheable, `ttlMs: 300_000`).
- `memoryLocalPlugin` / `default` — a `YggdrasilPlugin` (id `"context-memory-local"`) whose
  `register(api)` only calls `api.registerContextProvider(memoryLocalProvider)` — no gateway
  methods, no service, unlike `context-memory-db`.

## Depends on

- `@yggdrasil/context-sdk` — types.
- `@yggdrasil/sdk` — `definePlugin`.

## Used by

Nothing currently. Same situation as `context-memory-db`: no `yggdrasil.plugin.json` manifest, not
in `bootstrapKernel`'s `bundledPlugins` in `packages/cli/src/index.ts`, referenced only by its own
`package.json` and the `vitest.config.ts` path alias. No test files exist for this package.

## Configuration

None. The three source locations (`YGGDRASIL.md`, `.yggdrasil/memory/`, `~/.yggdrasil/memory/`) are
hardcoded in `src/index.ts`, not read from `ctx.config` or `yggdrasil.config.json`.

## Extending / what's safe to change

- This is the package closest to the "reads CLAUDE.md/AGENTS.md-style instructions" part of the
  original hypothesis — `YGGDRASIL.md` at the workspace root plays that role. (`context-project`,
  by contrast, does *not* read any instruction files — see its README.)
- To make the source directories configurable, follow the pattern in `context-prompt-files`: read
  a `paths`-style field off `ctx.config` instead of hardcoding `join(ctx.workspaceRoot, ...)`.
- To add another memory tier (e.g. a team-shared directory), add another `readMdDir(...)` call and
  push its results into `parts` before the final join.
- `readMdDir` only reads the top level of each directory (no recursion into subfolders) — extend it
  if nested memory files are needed.
- To activate: same manifest/`bundledPlugins` wiring described in `context-memory-db`'s README.
