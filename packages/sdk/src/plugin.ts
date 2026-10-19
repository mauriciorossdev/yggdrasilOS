import type { AgentToolDefinition } from "@yggdrasil/tools-sdk";
import type { ContextProviderRegistration } from "@yggdrasil/context-sdk";
import type { AgentHarness } from "./harness.js";
import type { ChannelPlugin } from "./channel.js";
import type { ProviderPlugin } from "./provider.js";
import type { ConfigSchema, EventBus, PluginLogger } from "./harness.js";

export type GatewayRequest = {
  method: string;
  params?: Record<string, unknown>;
  id?: string | number;
};

export type GatewayResponse = {
  id?: string | number;
  result?: unknown;
  error?: { code: string; message: string };
};

export type GatewayHandler = (
  params: Record<string, unknown>,
  ctx: GatewayHandlerContext,
) => Promise<unknown>;

export type GatewayHandlerContext = {
  config: unknown;
  events: EventBus;
  logger: PluginLogger;
  /** The calling WS connection's id, when this call came in over a real WS socket — undefined for the non-WS `invokeGatewayMethod` path. Lets a plugin handler check loopback-only gating the same way core methods do (see `isLoopbackConnection` in @yggdrasil/gateway). */
  connectionId?: string;
};

export type ToolContext = {
  sessionKey: string;
  config: unknown;
  workspaceRoot?: string;
};

/** @deprecated Use AgentToolDefinition from @yggdrasil/tools-sdk */
export type AgentTool = {
  name: string;
  description: string;
  execute(ctx: ToolContext, args: Record<string, unknown>): Promise<unknown>;
};

export type ToolFactory = (ctx: { config: unknown }) => AgentTool[] | Promise<AgentTool[]>;

export type ToolRegistration = AgentToolDefinition | ToolFactory;

export type ServicePlugin = {
  id: string;
  start(ctx: { config: unknown; logger: PluginLogger }): Promise<void> | void;
  stop?(): Promise<void> | void;
};

export type YggdrasilPlugin = {
  id: string;
  name?: string;
  version?: string;
  configSchema?: ConfigSchema;
  register(api: YggdrasilPluginApi): void | Promise<void>;
};

export type SkillCommand = {
  name: string;
  description: string;
  prompt: string;
};

export type YggdrasilPluginApi = {
  pluginId: string;
  config: unknown;
  globalConfig: unknown;
  logger: PluginLogger;
  events: EventBus;
  registerHarness(harness: AgentHarness): void;
  registerChannel(channel: ChannelPlugin): void;
  registerProvider(provider: ProviderPlugin): void;
  registerTool(tool: ToolRegistration): void;
  registerGatewayMethod(name: string, handler: GatewayHandler): void;
  registerService(service: ServicePlugin): void;
  registerContextProvider(provider: ContextProviderRegistration): void;
  registerSkillCommand(cmd: SkillCommand): void;
};

export function definePlugin(def: YggdrasilPlugin): YggdrasilPlugin {
  return def;
}

export function defineChannelEntry(channel: ChannelPlugin): ChannelPlugin {
  return channel;
}

export type { AgentToolDefinition } from "@yggdrasil/tools-sdk";
export type { ContextProviderRegistration, ContextProvider, ContextBlock, ContextProviderContext } from "@yggdrasil/context-sdk";
