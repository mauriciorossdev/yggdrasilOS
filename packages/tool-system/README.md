# @yggdrasil/tool-system

## Purpose

A first-party plugin (bundled in this monorepo, but loaded through the
regular plugin mechanism, not statically imported by anything) that gives an
agent access to the host machine: filesystem, running processes, installed
apps, OS info, and arbitrary shell command execution. This is the package to
look at for real, non-trivial tools with actual side effects and cross-platform
(Windows/macOS/Linux) branching logic.

It registers seven tools, defined across four files:

| Tool | File | `riskLevel` | Notes |
|---|---|---|---|
| `system_info` | `src/system-info.ts` | `safe` | OS/CPU/mem/uptime/Node version via `node:os` |
| `list_directory` | `src/filesystem.ts` | `safe` | `readdir` with file/dir typing |
| `read_file` | `src/filesystem.ts` | `safe` | truncates at 50,000 chars, reports `truncated`/`totalLength` |
| `write_file` | `src/filesystem.ts` | `destructive` | overwrites/creates a file — approval required |
| `list_processes` | `src/processes.ts` | `safe` | `tasklist` on win32, `ps` (with a fallback `ps` invocation) elsewhere |
| `list_installed_apps` | `src/processes.ts` | `safe` | registry query (win32), `/Applications` scan (darwin), `dpkg`/`rpm` (linux) |
| `run_command` | `src/shell.ts` | `destructive` | runs an arbitrary shell command via `child_process.exec` — approval required |

`src/exec.ts` provides shared plumbing: `execAsync` (promisified
`child_process.exec`) and `EXEC_OPTS` (`{ maxBuffer: 10MB, timeout: 30s }`)
used by both `processes.ts` and `shell.ts`.

`src/index.ts` wraps all seven tools in a `definePlugin(...)` and registers
them via `api.registerTool(tool)` in `register(api)`.

## Public API

`src/index.ts` default-exports the plugin object (id `"tool-system"`); there
is no named export consumers import directly — the plugin is loaded by id,
not by importing this package's code. Individual tool objects
(`systemInfoTool`, `listDirectoryTool`, `readFileTool`, `writeFileTool`,
`listProcessesTool`, `listInstalledAppsTool`, `runCommandTool`) are exported
from their respective source files but nothing outside this package imports
them today.

`yggdrasil.plugin.json`:
```json
{ "id": "tool-system", "kind": ["service"], "entry": "./dist/index.js", "compat": { "pluginApi": ">=0.3.0" } }
```

## Depends on

- `@yggdrasil/sdk` — `definePlugin`, plugin API types.
- `@yggdrasil/tools-sdk` — `defineTool` for each tool.
- Node built-ins only otherwise (`node:os`, `node:fs/promises`, `node:child_process`, `node:util`) — no third-party runtime dependencies.

## Used by

Nobody imports this package's code directly. It is discovered and loaded at
runtime by the kernel's plugin loader (`@yggdrasil/kernel`'s
`plugin-loader.ts`), which scans `packages/*` and `extensions/*` (plus
`node_modules/@yggdrasil/*` when `discoverNodeModules` is on) for
`yggdrasil.plugin.json` manifests and dynamically `import()`s the `entry`
file. Once loaded, its tools flow into `@yggdrasil/tools-runtime`'s registry
via `getRegistry().tools` and become available to `harness-llm` and the
gateway's `tools.list` method like any other tool.

## Configuration

No `configSchema` is declared, and `register(api)` doesn't read `api.config`
— the plugin has no configuration surface today. It can be turned off
per-installation via `plugins.disabled: ["tool-system"]` in
`yggdrasil.config.json`.

## Extending / what's safe to change

This package is the reference example for "a real plugin with multiple
tools, some destructive." Use it as the template when building a new tool
plugin that needs actual system/network access:

1. Scaffold with `node packages/cli/dist/index.js create-plugin <name> --kind tool` (or copy this package's shape by hand: `src/index.ts` default-exporting `definePlugin(...)`, one file per tool group, a `yggdrasil.plugin.json` manifest with `id`/`entry`/`compat`).
2. Each tool is a `defineTool(...)` call (see `@yggdrasil/tools-sdk`'s README for the full field-by-field contract). Tool names here are already correctly snake_case (`system_info`, `list_directory`, `run_command`, etc.) — keep following that convention for new tools.
3. Set `riskLevel` honestly: `write_file` and `run_command` are `destructive` because they mutate the filesystem or execute arbitrary commands — both rely on `defineTool` auto-setting `requiresApproval: true`. Everything else here is read-only and marked `safe`. If you add a tool that, say, only writes to a scratch/temp directory you control, `moderate` plus an explicit `requiresApproval` decision is more honest than blanket `safe`/`destructive`.
4. Register each tool with `api.registerTool(tool)` inside `register(api)`.
5. Truncate/bound anything unbounded (see `MAX_READ_BYTES` in `filesystem.ts`, `MAX_OUTPUT` in `shell.ts`, `MAX_ROWS` in `processes.ts`) — tool output goes back into the LLM's context window, so unbounded output from a big file or command is a real cost/failure mode, not just cosmetic.
6. `run_command` executes on the actual host machine with the permissions of the Yggdrasil process — there is no sandboxing here. Don't weaken its `destructive` classification, and think twice before adding more tools with this level of access without equally strong approval gating.

Safe to change without wider impact: adding a new safe, read-only tool to
this plugin, or tightening/adding validation to existing tools' `args`
handling (note current tools do very little input validation beyond
`String(args.x ?? ...)` — hardening this is low-risk and likely worthwhile).
Changing `id: "tool-system"` in either `src/index.ts` or
`yggdrasil.plugin.json` would break plugin discovery/dedup — keep them in
sync if you ever rename it.
