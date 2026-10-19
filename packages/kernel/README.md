# @yggdrasil/kernel

## Purpose

The kernel is the process-wide plugin registry and lifecycle controller. Every extensible piece of the
platform — harnesses, channels, providers, tools, gateway RPC methods, background services, context
providers — gets registered into a single in-memory registry that lives here, and every other package
(pipeline, gateway, harness-runtime, context-runtime, tools-runtime, cli) reads that registry instead of
importing plugins directly. It also owns plugin *discovery*: scanning `packages/` and `extensions/` (plus
`node_modules/@yggdrasil/*`) for `yggdrasil.plugin.json` manifests, importing the matching entry module, and
calling its `register()` with a scoped API. Without the kernel there is no way for a channel to find a
harness, or a harness to find a provider — it is the thing that turns independently-built plugin packages
into one running system.

## Public API

`packages/kernel/src/index.ts` re-exports everything from `registry.ts`, `plugin-api.ts`,
`plugin-loader.ts`, and `lifecycle.ts`.

**registry.ts** — the registry itself, stored on `globalThis` behind `Symbol.for("yggdrasil.registry")`
(so it survives multiple module instances, e.g. across a workspace symlink boundary):
- `getRegistry()` — returns the singleton `RegistryState` (plugins, harnesses, channels, providers, tools,
  gatewayMethods, services, contextProviders maps/arrays), creating it on first access.
- `resetRegistryForTest()` — wipes the registry; used in `beforeEach` in tests across the monorepo.
- `registerHarness(harness, options?)` / `listHarnesses()` / `getHarness(id)` — harness registration and lookup.
- `registerChannel(channel, ownerPluginId?)` / `listChannels()` / `getChannel(id)` — channel registration;
  `registerChannel` is a no-op if the id is already taken (first registration wins).
- `registerProvider(provider)` / `listProviders()` / `getProvider(id)` — LLM provider registration.
- `registerTool(tool)` — pushes a `ToolRegistration` (an `AgentToolDefinition` or a `ToolFactory`).
- `registerGatewayMethod(name, handler)` — lets a plugin add a custom gateway RPC method.
- `registerService(service)` / `stopAllServices()` — long-running background services with `start`/`stop`.
- `registerContextProvider(provider)` / `listContextProviders()` — context-assembly providers.
- `registerPlugin(record)` / `listPlugins()` — bookkeeping of loaded plugin metadata (id/name/version).
- `disposeAllHarnesses()` — calls `dispose()` on every registered harness.
- `createConsoleLogger(prefix)` — a `PluginLogger` that prefixes `console.*` calls with `[prefix]`.
- `createEventBus()` — an in-process pub/sub (`on`/`emit`/`off`) used for `turn.start`, `chat.delta`, etc.

**plugin-api.ts**
- `createPluginApi(options)` — builds the `YggdrasilPluginApi` object (from `@yggdrasil/sdk`) passed into a
  plugin's `register()`. Each of its `register*` methods is a thin, pre-bound wrapper around the
  corresponding `registry.ts` function, closed over the plugin's own id so registrations are attributable.

**plugin-loader.ts**
- `discoverNodeModulesPluginPaths(workspaceRoot, options?)` — finds `node_modules/@yggdrasil` (and
  optionally all of `node_modules`) as plugin search roots.
- `discoverPlugins(searchPaths)` — walks search paths (and one level of subdirectories) for
  `yggdrasil.plugin.json`, parses and filters by `isPluginApiCompatible`, returns `PluginCandidate[]`.
- `loadPlugins(options: LoadPluginsOptions)` — the main entry point: registers `bundledPlugins` first, then
  dynamically `import()`s every discovered candidate's entry file and calls `register()` on it. Skips
  anything in `config.plugins.disabled` or already loaded. Returns `LoadPluginsResult` (`loaded`, `errors`).
- `readPluginManifest(manifestPath)` — reads and parses one manifest file.
- `resolvePluginSearchPaths(options)` / `resolvePluginSearchPathsAsync(options)` — build the list of
  directories to scan: `packages/`, `extensions/`, any `config.plugins.load.paths`, plus (async variant)
  the node_modules paths unless `config.plugins.discoverNodeModules === false`.

**lifecycle.ts** — the kernel's own state machine (`"idle" | "bootstrapped" | "running" | "stopped"`),
held in a module-level `kernelContext` singleton:
- `getKernelContext()` — current `KernelContext | null`.
- `bootstrapKernel(options)` — resolves plugin search paths, calls `loadPlugins`, and sets
  `kernelContext` to `{ config, workspaceRoot, state: "bootstrapped", bundledPlugins }`. Must run before
  `startKernel`.
- `startKernel()` — starts every registered `ServicePlugin` and calls `onStart()` on every channel's
  lifecycle adapter; sets state to `"running"`.
- `stopKernel()` — calls `onStop()` on channels and `stopAllServices()`; sets state to `"stopped"`.
- `disposeKernel()` — `stopKernel()` + `disposeAllHarnesses()` + clears `kernelContext` to `null`.
- `resetKernelForTest()` — clears `kernelContext` without running stop/dispose hooks (test-only).

## Depends on

- **`@yggdrasil/config`** — only for the `YggdrasilConfig` type, used to read `plugins.load.paths`,
  `plugins.disabled`, `plugins.discoverNodeModules`, `plugins.discoverAll`, and `pluginConfig` during
  discovery/loading (`plugin-loader.ts`, `lifecycle.ts`).
- **`@yggdrasil/sdk`** — the contract types the registry stores and the loader validates against:
  `AgentHarness`, `ChannelPlugin`, `ProviderPlugin`, `ToolRegistration`, `ServicePlugin`,
  `YggdrasilPlugin`/`YggdrasilPluginApi`, `GatewayHandler`, `EventBus`, `PluginLogger`,
  `ContextProviderRegistration`, and the manifest helpers (`PLUGIN_MANIFEST_FILENAME`,
  `isPluginApiCompatible`, `parsePluginManifest`, `YggdrasilPluginManifest`).

## Used by

- **`packages/cli/src/index.ts`** — calls `bootstrapKernel` → `startKernel` on `yggdrasil run`/`tui`/`gateway`,
  and `stopKernel`/`disposeKernel` on shutdown. This is the top-level orchestrator of the whole process.
- **`packages/gateway`** (`channel-manager.ts`, `methods.ts`) — `listChannels()` to iterate configured
  channels, `createConsoleLogger`, and `getRegistry()` to dispatch plugin-registered gateway methods
  (`handleGatewayRequest` checks `getRegistry().gatewayMethods` before falling back to core methods).
- **`packages/pipeline/src/turn-kernel.ts`** — `getChannel`, `getHarness`, `getProvider` to resolve the
  concrete plugin instances needed to run one conversational turn.
- **`packages/harness-llm/src/harness.ts`** — `getProvider(providerId)` to fetch the registered
  `ProviderPlugin` for chat completion.
- **`packages/harness-runtime`** (`builtin/echo.ts`, `selection.ts`) — `registerHarness` for the built-in
  echo fallback harness; `getHarness`/`listHarnesses` for harness selection logic.
- **`packages/context-runtime/src/resolve.ts`** — `listContextProviders()` to assemble context blocks;
  `registerContextProvider` is used in its tests via `resetRegistryForTest`.
- **`packages/tools-runtime/src/resolve.ts`** — `getRegistry()` to read registered tools.

## Configuration

Read (indirectly, via the `YggdrasilConfig` passed into `bootstrapKernel`/`loadPlugins`):
- `plugins.load.paths` — extra directories to scan for plugins.
- `plugins.discoverNodeModules` — whether to also scan `node_modules/@yggdrasil`.
- `plugins.discoverAll` — whether to scan all of `node_modules` (not just the `@yggdrasil` scope).
- `plugins.disabled` — plugin ids to skip even if discovered.
- `pluginConfig[pluginId]` — passed as `config` into each plugin's `createPluginApi` call.

## Extending / what's safe to change

- **Adding a new registrable "kind"** (e.g. a new category of plugin beyond harness/channel/provider/tool/
  service/gatewayMethod/contextProvider) touches three files in lockstep: add the contract type to
  `@yggdrasil/sdk` (`plugin.ts` or a sibling), add a `Map`/array field to `RegistryState` plus
  `register*`/`list*`/`get*` functions in `registry.ts`, and add a `register*` method to
  `YggdrasilPluginApi` wired through `createPluginApi` in `plugin-api.ts`. All three must move together or
  plugins compile against a stale API.
- **This is shared, singleton, global-mutable state.** `getRegistry()` uses `globalThis` specifically so
  that duplicated installs of `@yggdrasil/kernel` (e.g. via nested `node_modules`) don't create split-brain
  registries. If you ever change that to a non-global module-scoped variable, every test that runs kernel
  and pipeline/gateway in the same process (most integration/e2e tests, see `test/helpers/createTestPlatform`)
  will start seeing "not registered" failures.
- **`resetRegistryForTest()` / `resetKernelForTest()` are test-only escape hatches** — they don't call
  `dispose()`/`stop()` hooks. Don't use them outside `beforeEach` blocks; use `disposeKernel()` for real
  teardown.
- **Plugin discovery order matters for conflicts**: `registerChannel` silently ignores a second
  registration of the same id (first loaded wins), while `registerProvider`/`registerHarness` silently
  overwrite. If you change discovery order (`resolvePluginSearchPaths` scans `packages/` before
  `extensions/`, then `plugins.load.paths`, then node_modules) you change which plugin wins on an id
  collision.
- Safe to change without ripple: the internals of `createConsoleLogger`/`createEventBus` formatting, as
  long as the `PluginLogger`/`EventBus` shapes from `@yggdrasil/sdk` are preserved.
