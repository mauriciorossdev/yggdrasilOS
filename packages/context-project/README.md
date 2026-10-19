# @yggdrasil/context-project

## Purpose

Read-only, structural project/repo introspection provider. **This is not the "reads
CLAUDE.md/AGENTS.md-style instructions" package** — that hypothesis was wrong for this one (it's a
better fit for `context-memory-local`'s `YGGDRASIL.md` handling). Instead, `context-project` shells
out to `git` and does lightweight filesystem sniffing to build a short factual summary of the repo
the agent is running in:

- current git branch and uncommitted-file count (`git rev-parse --abbrev-ref HEAD`,
  `git status --porcelain`, each run with a 3s timeout, failures swallowed to `""`)
- detected languages, from presence of marker files: `tsconfig.json`/`tsconfig.base.json` →
  TypeScript, `package.json` → JavaScript/Node, `go.mod` → Go, `Cargo.toml` → Rust,
  `requirements.txt`/`pyproject.toml` → Python
- detected package manager, from lockfile presence: `pnpm-lock.yaml`/`pnpm-workspace.yaml` → pnpm,
  `yarn.lock` → yarn, `bun.lockb` → bun, `package-lock.json` → npm, else `"unknown"`
- up to 20 top-level file names in the workspace root (only the first 10 are included in the
  output text)
- project name, read from `package.json`'s `name` field (falls back to the last path segment of
  `workspaceRoot`)

**Not currently wired into the running application** — see "Used by" below.

## Public API

`packages/context-project/src/index.ts` exports:

- `projectContextProvider: ContextProvider` — `id: "project-context"`, `priority: 30` (the highest
  priority number among the four provider packages, so it sorts last in `context-runtime`'s
  ascending-priority output). Always returns exactly one block (never empty — even an empty repo
  still gets a `## Project Context` block). Cacheable, `ttlMs: 60_000`.
- `projectContextPlugin` / `default` — a `YggdrasilPlugin` (id `"context-project"`) whose
  `register(api)` only calls `api.registerContextProvider(projectContextProvider)`.

## Depends on

- `@yggdrasil/context-sdk` — types.
- `@yggdrasil/sdk` — `definePlugin`.
- `node:child_process` (via `promisify(exec)`) — requires `git` to be on `PATH`; git failures are
  caught and reported as `"not a git repo"`, not thrown.

## Used by

Nothing currently. Same situation as the other unwired provider packages: no
`yggdrasil.plugin.json` manifest, not listed in `bootstrapKernel`'s `bundledPlugins` in
`packages/cli/src/index.ts`, referenced only by its own `package.json` and the `vitest.config.ts`
path alias. No test files exist for this package.

## Configuration

None — no fields are read from `ctx.config`.

## Extending / what's safe to change

- Language/package-manager detection is a fixed if-list in `detectLanguages`/`detectPackageManager`
  — extend by adding more marker-filename checks.
- Every `assemble()` call runs two git subprocesses plus several `readdir`/`readFile` calls. They
  run in parallel (`Promise.all`) and are individually capped, but they still count against
  `context-runtime`'s overall 2000ms per-provider timeout — keep any additions cheap or the whole
  block silently drops for that turn.
- To activate: same manifest/`bundledPlugins` wiring described in `context-memory-db`'s README.
