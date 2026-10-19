import type { YggdrasilPluginApi } from "@yggdrasil/sdk";
import {
  createConsoleLogger,
  registerChannel,
  registerContextProvider,
  registerGatewayMethod,
  registerHarness,
  registerProvider,
  registerService,
  registerSkillCommand,
  registerTool,
} from "./registry.js";
import type { EventBus, PluginLogger } from "@yggdrasil/sdk";

export function createPluginApi(options: {
  pluginId: string;
  config: unknown;
  globalConfig: unknown;
  logger?: PluginLogger;
  events: EventBus;
}): YggdrasilPluginApi {
  const logger = options.logger ?? createConsoleLogger(options.pluginId);
  return {
    pluginId: options.pluginId,
    config: options.config,
    globalConfig: options.globalConfig,
    logger,
    events: options.events,
    registerHarness(harness) {
      registerHarness(harness, { ownerPluginId: options.pluginId });
    },
    registerChannel(channel) {
      registerChannel(channel, options.pluginId);
    },
    registerProvider(provider) {
      registerProvider(provider);
    },
    registerTool(factory) {
      registerTool(factory, options.pluginId);
    },
    registerGatewayMethod(name, handler) {
      registerGatewayMethod(name, handler, options.pluginId);
    },
    registerService(service) {
      registerService(service, options.pluginId);
    },
    registerContextProvider(provider) {
      registerContextProvider(provider, options.pluginId);
    },
    registerSkillCommand(cmd) {
      registerSkillCommand(cmd, options.pluginId);
    },
  };
}
