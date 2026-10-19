import type { YggdrasilConfig } from "@yggdrasil/config";
import type { EventBus, YggdrasilPlugin } from "@yggdrasil/sdk";
import {
  createConsoleLogger,
  createEventBus,
  disposeAllHarnesses,
  getRegistry,
  listChannels,
  registerPlugin,
  stopAllServices,
  unregisterPlugin,
} from "./registry.js";
import {
  discoverPlugins,
  importPluginModule,
  loadPlugins,
  resolvePluginSearchPathsAsync,
} from "./plugin-loader.js";
import { createPluginApi } from "./plugin-api.js";

export type KernelState = "idle" | "bootstrapped" | "running" | "stopped";

export type KernelContext = {
  config: YggdrasilConfig;
  workspaceRoot: string;
  state: KernelState;
  bundledPlugins?: YggdrasilPlugin[];
  /**
   * The one real EventBus for this process, shared by every plugin's
   * `register(api)` call (via loadPlugins' `events` option) AND available
   * here for anything bootstrapped afterward to reuse instead of minting its
   * own isolated bus — see packages/gateway/src/methods.ts's
   * createDefaultGatewayContext, which reuses this so a plugin's
   * registration-time `api.events` and the gateway's own per-connection
   * broadcast bus are the SAME instance. Before this field existed, they
   * were two separate buses (loadPlugins created its own locally), which
   * silently dead-lettered any event a plugin emitted on `api.events` outside
   * a gateway-method call's own per-request `ctx.events` (itself already
   * this same bus) — found via extensions/service-workflows's `phone.tool`
   * node (notes/automation/workflows-design.md, fase 6's write-up) and still
   * affecting its Scheduler/event-trigger `workflow.*` status events until
   * this field was added.
   */
  events: EventBus;
};

let kernelContext: KernelContext | null = null;

export function getKernelContext(): KernelContext | null {
  return kernelContext;
}

export async function bootstrapKernel(options: {
  config: YggdrasilConfig;
  workspaceRoot: string;
  bundledPlugins?: YggdrasilPlugin[];
}): Promise<KernelContext> {
  const searchPaths = await resolvePluginSearchPathsAsync({
    workspaceRoot: options.workspaceRoot,
    config: options.config,
    extraPaths: options.config.plugins?.load?.paths,
  });

  const events = createEventBus();
  const result = await loadPlugins({
    config: options.config,
    pluginConfig: options.config.pluginConfig,
    searchPaths,
    bundledPlugins: options.bundledPlugins,
    events,
  });

  if (result.errors.length > 0) {
    for (const err of result.errors) {
      console.warn(`[yggdrasil] plugin load failed: ${err.path}: ${err.error}`);
    }
  }

  kernelContext = {
    config: options.config,
    workspaceRoot: options.workspaceRoot,
    state: "bootstrapped",
    bundledPlugins: options.bundledPlugins,
    events,
  };

  return kernelContext;
}

export async function startKernel(): Promise<void> {
  if (!kernelContext) {
    throw new Error("Kernel not bootstrapped. Call bootstrapKernel() first.");
  }
  const registry = getRegistry();
  for (const service of registry.services.values()) {
    await service.start({ config: kernelContext.config, logger: console as never });
  }
  for (const channel of listChannels()) {
    await channel.lifecycle?.onStart?.();
  }
  kernelContext.state = "running";
}

export async function stopKernel(): Promise<void> {
  if (!kernelContext) return;
  for (const channel of listChannels()) {
    await channel.lifecycle?.onStop?.();
  }
  await stopAllServices();
  kernelContext.state = "stopped";
}

export async function disposeKernel(): Promise<void> {
  await stopKernel();
  await disposeAllHarnesses();
  kernelContext = null;
}

export function resetKernelForTest(): void {
  kernelContext = null;
}

export async function hotLoadPlugin(
  pluginId: string,
): Promise<{ success: boolean; error?: string }> {
  if (!kernelContext) return { success: false, error: "Kernel not running" };

  const registry = getRegistry();
  if (registry.plugins.has(pluginId)) {
    return { success: true };
  }

  const searchPaths = await resolvePluginSearchPathsAsync({
    workspaceRoot: kernelContext.workspaceRoot,
    config: kernelContext.config,
    extraPaths: kernelContext.config.plugins?.load?.paths,
  });

  const candidates = await discoverPlugins(searchPaths);
  const candidate = candidates.find((c) => c.manifest.id === pluginId);
  if (!candidate) {
    return { success: false, error: `Plugin "${pluginId}" not found in search paths` };
  }

  try {
    const plugin = await importPluginModule(candidate, false);
    const api = createPluginApi({
      pluginId: plugin.id,
      config: (kernelContext.config.pluginConfig as Record<string, unknown>)?.[plugin.id] ?? {},
      globalConfig: kernelContext.config,
      logger: createConsoleLogger(plugin.id),
      events: kernelContext.events,
    });
    await plugin.register(api);
    registerPlugin({
      id: plugin.id,
      name: plugin.name ?? candidate.manifest.name,
      version: plugin.version ?? candidate.manifest.version,
      module: plugin,
    });

    if (kernelContext.state === "running") {
      const newService = getRegistry().services.get(plugin.id);
      if (newService) {
        await newService.start({ config: kernelContext.config, logger: console as never });
      }
    }

    console.log(`[yggdrasil] hot-loaded plugin: ${plugin.id}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function hotUnloadPlugin(pluginId: string): Promise<void> {
  const registry = getRegistry();
  const service = registry.services.get(pluginId);
  if (service) {
    await service.stop?.();
  }
  unregisterPlugin(pluginId);
  console.log(`[yggdrasil] hot-unloaded plugin: ${pluginId}`);
}
