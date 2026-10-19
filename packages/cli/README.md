# @yggdrasil/cli

## Purpose

The `yggdrasil` command-line entrypoint. It bootstraps the kernel and gateway, starts/stops channels, launches the interactive TUI, manages plugins, and scaffolds new plugin packages. This is the thing a user types after installing the platform; almost everything else in the workspace gets wired together and started from here.

## Public API / How you run it

- **Binary**: `bin: yggdrasil` → `dist/index.js` (source: `packages/cli/src/index.ts`). `main()` dispatches on `process.argv`:

  | Command | What it does |
  |---|---|
  | `yggdrasil init` | Writes a starter `yggdrasil.config.json` + `extensions/` dir in cwd (`cmdInit`, `src/plugin-commands.ts`) |
  | `yggdrasil run` | Bootstraps the kernel, starts the gateway with **both** `channel-tui` and `channel-http` enabled (`cmdRun`) — the "run everything headless-ish" mode |
  | `yggdrasil tui [--continue] [--connect <ws-url>] [--legacy]` | The interactive path (`cmdTui`): probes for an already-running gateway (`probeGateway`, hits `GET /`), attaches `@yggdrasil/app-tui` to it if found, otherwise boots a gateway with channels disabled and launches `app-tui` against it. `--legacy` instead starts the gateway with `channel-tui` enabled (`cmdTuiLegacy`) — the plain-readline mode |
  | `yggdrasil gateway` | Starts the gateway headless, no channels (`cmdGateway`) |
  | `yggdrasil plugin list \| install <pkg> \| enable <id> \| disable <id> \| create <name> [--kind]` | Plugin lifecycle management (`cmdPlugin`, `src/plugin-commands.ts`) |
  | `yggdrasil create-plugin <name> [--kind tool\|channel\|harness\|provider]` | Alias for `plugin create` (`cmdCreatePlugin`) |
  | `yggdrasil help` | Prints usage |

- **Scaffolding module** (`src/create-plugin.ts`): `createPluginProject({ name, kind, outputDir })` and `scaffoldPlugin(workspaceRoot, name, kind)` — renders `templates/<kind>/{package.json,tsconfig.json,yggdrasil.plugin.json,src/index.ts}` with `{{PLUGIN_NAME}}`/`{{PLUGIN_ID}}`/`{{PACKAGE_NAME}}`/`{{PLUGIN_LABEL}}` substitution into `extensions/<plugin-id>/`. Re-exported from `src/index.ts` (`export { createPluginProject, scaffoldPlugin }`) for programmatic use.
- **Config I/O** (`src/config-io.ts`): thin re-export of `@yggdrasil/config`'s `readConfigFile`/`writeConfigFile`/`uniqueStrings`.
- **Workspace resolution** (`src/workspace.ts`): `resolveWorkspaceRoot()` — resolution order is `YGGDRASIL_WORKSPACE` env var → nearest ancestor directory containing `yggdrasil.config.json` (`findConfigPath`, walks up from cwd) → cwd. `resolveConfigPath(workspaceRoot)` joins in the fixed filename `yggdrasil.config.json`.

## Depends on

- `@yggdrasil/app-tui` — launched dynamically for `yggdrasil tui`.
- `@yggdrasil/channel-tui` — `createTuiApprovalPrompt` for wiring y/n tool approval into `run` / `tui --legacy`.
- `@yggdrasil/config` — config read/write, merge, types.
- `@yggdrasil/gateway` — `startGatewayServer`.
- `@yggdrasil/harness-runtime` — `registerBuiltinHarnesses()`.
- `@yggdrasil/kernel` — `bootstrapKernel`, `startKernel`, `stopKernel`, `disposeKernel`.
- `@yggdrasil/sdk` — `ToolApprovalHandler` type.
- `@yggdrasil/sessions` — `initSessionStore`, `resetSessionStoreForTest`.

`channel-http` is *not* a direct dependency — it's enabled via config (`channels.http.enabled: true`) and picked up by the gateway's own plugin loader, not imported here.

## Used by

Nothing in the workspace depends on `@yggdrasil/cli` as a library (no `packages/*/package.json` references it) — it's a top-level, install-and-run binary. Its `templates/` directory (see `files` in `package.json`) ships inside the published package specifically so `create-plugin` works from an installed CLI, not just from a repo checkout.

## Configuration

Reads/writes the whole `yggdrasil.config.json` at the resolved workspace root. Notably touches:

- `gateway.host` / `gateway.port` — default `127.0.0.1:18789`.
- `channels.tui.enabled`, `channels.http.enabled`, `channels.http.accounts.default.port` (set to `18790` by `cmdRun`).
- `harness.toolApproval` (`"never" | "destructive-only" | ...`, default `destructive-only`) — read by `buildApprovalHandler` to decide whether/when to prompt via `channel-tui`'s approval prompt.
- `plugins.installed` / `plugins.disabled` — mutated by `plugin install/enable/disable`.

## Extending / what's safe to change

- **New top-level command**: add a `case` in `main()`'s `switch (command)`, add a `cmd*` async function near the others, and update `printHelp()`.
- **New plugin kind for `create-plugin`**: add a `templates/<kind>/` directory mirroring the existing ones (`channel/`, `harness/`, `provider/`, `tool/` — each has `package.json`, `tsconfig.json`, `yggdrasil.plugin.json`, `src/index.ts`), then add the kind to the `validKinds` array in `cmdCreatePlugin` and to `PluginKind` in `create-plugin.ts`. Template files support `{{PLUGIN_NAME}}` / `{{PLUGIN_ID}}` / `{{PACKAGE_NAME}}` / `{{PLUGIN_LABEL}}` placeholders — extend `renderTemplate`'s `vars` object in `createPluginProject` if you need more.
- **New `plugin` subcommand**: add a `case` in `cmdPlugin` (`plugin-commands.ts`).
- Package manager detection for `plugin install` (`detectPackageManager` in `plugin-commands.ts`) checks `npm_config_user_agent` then falls back to probing `pnpm --version`; it only distinguishes pnpm vs npm today.
- Tests: `src/config-io.test.ts`, `src/workspace.test.ts` — extend these when touching config I/O or workspace resolution, since those are shared by every command.
