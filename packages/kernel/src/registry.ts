import type {
  AgentHarness,
  ChannelPlugin,
  ContextProviderRegistration,
  EventBus,
  GatewayHandler,
  PluginLogger,
  ProviderPlugin,
  RegisteredAgentHarness,
  ServicePlugin,
  SkillCommand,
  ToolRegistration,
  YggdrasilPlugin,
} from "@yggdrasil/sdk";

export type PluginRecord = {
  id: string;
  name?: string;
  version?: string;
  module: YggdrasilPlugin;
};

export type RegistryState = {
  plugins: Map<string, PluginRecord>;
  harnesses: Map<string, RegisteredAgentHarness>;
  channels: Map<string, ChannelPlugin>;
  providers: Map<string, ProviderPlugin>;
  tools: ToolRegistration[];
  gatewayMethods: Map<string, GatewayHandler>;
  services: Map<string, ServicePlugin>;
  contextProviders: ContextProviderRegistration[];
  skillCommands: SkillCommand[];
  // ownership tracking for hot-reload
  toolOwners: Map<string, string>;
  contextProviderOwners: Map<string, string>;
  skillCommandOwners: Map<string, string>;
  gatewayMethodOwners: Map<string, string>;
  serviceOwners: Map<string, string>;
};

const REGISTRY_KEY = Symbol.for("yggdrasil.registry");

type GlobalWithRegistry = typeof globalThis & {
  [REGISTRY_KEY]?: RegistryState;
};

function createEmptyRegistry(): RegistryState {
  return {
    plugins: new Map(),
    harnesses: new Map(),
    channels: new Map(),
    providers: new Map(),
    tools: [],
    gatewayMethods: new Map(),
    services: new Map(),
    contextProviders: [],
    skillCommands: [],
    toolOwners: new Map(),
    contextProviderOwners: new Map(),
    skillCommandOwners: new Map(),
    gatewayMethodOwners: new Map(),
    serviceOwners: new Map(),
  };
}

export function getRegistry(): RegistryState {
  const g = globalThis as GlobalWithRegistry;
  if (!g[REGISTRY_KEY]) {
    g[REGISTRY_KEY] = createEmptyRegistry();
  }
  return g[REGISTRY_KEY]!;
}

export function resetRegistryForTest(): void {
  const g = globalThis as GlobalWithRegistry;
  g[REGISTRY_KEY] = createEmptyRegistry();
}

export function registerHarness(
  harness: AgentHarness,
  options?: { ownerPluginId?: string },
): void {
  const registry = getRegistry();
  const id = harness.id.trim();
  registry.harnesses.set(id, {
    harness: { ...harness, id, pluginId: harness.pluginId ?? options?.ownerPluginId },
    ownerPluginId: options?.ownerPluginId,
  });
}

export function listHarnesses(): RegisteredAgentHarness[] {
  return [...getRegistry().harnesses.values()];
}

export function getHarness(id: string): RegisteredAgentHarness | undefined {
  return getRegistry().harnesses.get(id.trim());
}

export function registerChannel(channel: ChannelPlugin, ownerPluginId?: string): void {
  const registry = getRegistry();
  const id = channel.id.trim();
  if (registry.channels.has(id)) {
    return;
  }
  registry.channels.set(id, { ...channel, id });
  void ownerPluginId;
}

export function listChannels(): ChannelPlugin[] {
  return [...getRegistry().channels.values()];
}

export function getChannel(id: string): ChannelPlugin | undefined {
  return getRegistry().channels.get(id.trim());
}

export function registerProvider(provider: ProviderPlugin): void {
  getRegistry().providers.set(provider.id.trim(), provider);
}

export function listProviders(): ProviderPlugin[] {
  return [...getRegistry().providers.values()];
}

export function getProvider(id: string): ProviderPlugin | undefined {
  return getRegistry().providers.get(id.trim());
}

export function registerTool(tool: ToolRegistration, ownerPluginId?: string): void {
  const registry = getRegistry();
  registry.tools.push(tool);
  if (ownerPluginId) registry.toolOwners.set(tool.name, ownerPluginId);
}

export function registerGatewayMethod(name: string, handler: GatewayHandler, ownerPluginId?: string): void {
  const registry = getRegistry();
  registry.gatewayMethods.set(name.trim(), handler);
  if (ownerPluginId) registry.gatewayMethodOwners.set(name.trim(), ownerPluginId);
}

export function registerService(service: ServicePlugin, ownerPluginId?: string): void {
  const registry = getRegistry();
  registry.services.set(service.id.trim(), service);
  if (ownerPluginId) registry.serviceOwners.set(service.id.trim(), ownerPluginId);
}

export function registerContextProvider(provider: ContextProviderRegistration, ownerPluginId?: string): void {
  const registry = getRegistry();
  registry.contextProviders.push(provider);
  if (ownerPluginId) registry.contextProviderOwners.set(provider.id, ownerPluginId);
}

export function unregisterPlugin(id: string): void {
  const registry = getRegistry();
  registry.plugins.delete(id);

  const ownedToolNames = new Set(
    [...registry.toolOwners.entries()].filter(([, ownerId]) => ownerId === id).map(([name]) => name),
  );
  if (ownedToolNames.size > 0) {
    registry.tools = registry.tools.filter((t) => !ownedToolNames.has(t.name));
    for (const name of ownedToolNames) registry.toolOwners.delete(name);
  }

  const ownedProviderIds = new Set(
    [...registry.contextProviderOwners.entries()].filter(([, ownerId]) => ownerId === id).map(([pid]) => pid),
  );
  if (ownedProviderIds.size > 0) {
    registry.contextProviders = registry.contextProviders.filter((p) => !ownedProviderIds.has(p.id));
    for (const pid of ownedProviderIds) registry.contextProviderOwners.delete(pid);
  }

  const ownedCommandNames = new Set(
    [...registry.skillCommandOwners.entries()].filter(([, ownerId]) => ownerId === id).map(([name]) => name),
  );
  if (ownedCommandNames.size > 0) {
    registry.skillCommands = registry.skillCommands.filter((c) => !ownedCommandNames.has(c.name));
    for (const name of ownedCommandNames) registry.skillCommandOwners.delete(name);
  }

  for (const [k, ownerId] of registry.gatewayMethodOwners.entries()) {
    if (ownerId === id) {
      registry.gatewayMethods.delete(k);
      registry.gatewayMethodOwners.delete(k);
    }
  }

  for (const [k, ownerId] of registry.serviceOwners.entries()) {
    if (ownerId === id) {
      registry.services.delete(k);
      registry.serviceOwners.delete(k);
    }
  }
}

export function listContextProviders(): ContextProviderRegistration[] {
  return getRegistry().contextProviders;
}

export function registerSkillCommand(cmd: SkillCommand, ownerPluginId?: string): void {
  const registry = getRegistry();
  registry.skillCommands.push(cmd);
  if (ownerPluginId) registry.skillCommandOwners.set(cmd.name, ownerPluginId);
}

export function listSkillCommands(): SkillCommand[] {
  return getRegistry().skillCommands;
}

export function registerPlugin(record: PluginRecord): void {
  getRegistry().plugins.set(record.id, record);
}

export function listPlugins(): PluginRecord[] {
  return [...getRegistry().plugins.values()];
}

export async function disposeAllHarnesses(): Promise<void> {
  for (const { harness } of getRegistry().harnesses.values()) {
    await harness.dispose?.();
  }
}

export async function stopAllServices(): Promise<void> {
  for (const service of getRegistry().services.values()) {
    await service.stop?.();
  }
}

export function createConsoleLogger(prefix: string): PluginLogger {
  const tag = `[${prefix}]`;
  return {
    debug: (msg, meta) => console.debug(tag, msg, meta ?? ""),
    info: (msg, meta) => console.info(tag, msg, meta ?? ""),
    warn: (msg, meta) => console.warn(tag, msg, meta ?? ""),
    error: (msg, meta) => console.error(tag, msg, meta ?? ""),
  };
}

export function createEventBus(): EventBus {
  const handlers = new Map<string, Set<(payload: unknown) => void | Promise<void>>>();

  return {
    on(event, handler) {
      let set = handlers.get(event);
      if (!set) {
        set = new Set();
        handlers.set(event, set);
      }
      set.add(handler as (payload: unknown) => void | Promise<void>);
      return () => {
        set?.delete(handler as (payload: unknown) => void | Promise<void>);
      };
    },
    async emit(event, payload) {
      const set = handlers.get(event);
      if (!set) return;
      await Promise.all([...set].map((h) => h(payload)));
    },
    off(event, handler) {
      handlers.get(event)?.delete(handler as (payload: unknown) => void | Promise<void>);
    },
  };
}

