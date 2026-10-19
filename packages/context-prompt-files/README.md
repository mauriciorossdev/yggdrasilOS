# @yggdrasil/context-prompt-files

## Purpose

Read-only context provider that loads static Markdown "prompt" files from one or more configured
directories and concatenates their content into a system block — a directory of reusable
persona/instruction snippets rather than dynamic memory. Scans the top level (non-recursive) of
each configured directory for `*.md` files, sorted by filename, and joins their contents with `---`
separators; empty files are skipped.

**Not currently wired into the running application** — see "Used by" below.

## Public API

`packages/context-prompt-files/src/index.ts` exports:

- `promptFilesProvider: ContextProvider` — `id: "prompt-files"`, `priority: 0` (the lowest priority
  number of any of the four provider packages, so — per `context-runtime`'s ascending sort — its
  content sorts first among them). Returns `[]` if no directory yields any content; otherwise one
  block (cacheable, `ttlMs: 300_000`).
- `promptFilesPlugin` / `default` — a `YggdrasilPlugin` (id `"context-prompt-files"`) whose
  `register(api)` only calls `api.registerContextProvider(promptFilesProvider)`.

## Depends on

- `@yggdrasil/context-sdk` — types.
- `@yggdrasil/sdk` — `definePlugin`.

## Used by

Nothing currently. Same situation as the other unwired provider packages: no
`yggdrasil.plugin.json` manifest, not listed in `bootstrapKernel`'s `bundledPlugins` in
`packages/cli/src/index.ts`, referenced only by its own `package.json` and the `vitest.config.ts`
path alias. No test files exist for this package.

## Configuration

`ctx.config.paths` (string[], optional) — directories to scan for `*.md` files, each resolved
relative to `ctx.workspaceRoot`. Default: `["prompts"]`.

Note the same gap documented in `@yggdrasil/context-runtime`'s README: the way `turn-kernel.ts`
currently builds `ContextProviderContext.config` (from `pluginConfig[providerIds[0]]`, keyed by
provider ID rather than plugin ID, and shared across every provider resolved in the same call)
means `paths` generally won't reach `assemble()` as configured unless `"prompt-files"` happens to
be the first provider ID in the resolved list and `pluginConfig` happens to be keyed
`"prompt-files"` rather than `"context-prompt-files"`.

## Extending / what's safe to change

- To support non-Markdown files, adjust the `extname(e.name) === ".md"` filter in `findMdFiles`.
- To scan subdirectories, `findMdFiles` would need to walk recursively — currently it only reads
  the top level of each configured directory.
- To activate: same manifest/`bundledPlugins` wiring described in `context-memory-db`'s README, and
  fix the config-propagation gap above if per-deployment `paths` configuration is actually needed.
