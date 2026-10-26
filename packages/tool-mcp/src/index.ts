import type { YggdrasilConfig } from "@yggdrasil/config";
import { getRegistry } from "@yggdrasil/kernel";
import { definePlugin } from "@yggdrasil/sdk";
import { bridgeMcpTools, connectMcpServer } from "./client.js";
import { createMcpManager, type McpServers } from "./manager.js";

export type { McpServerState, McpServerStatus } from "./manager.js";

function serversOf(config: unknown): McpServers {
  return (config as YggdrasilConfig).mcpServers ?? {};
}

// Tools are looked up in the kernel registry on every agent turn (see
// tools-runtime resolveTools), so removing them here is enough to hide a
// disconnected server's tools — same bookkeeping unregisterPlugin does.
function removeToolsFromRegistry(names: string[]): void {
  const registry = getRegistry();
  const drop = new Set(names);
  registry.tools = registry.tools.filter((t) => typeof t === "function" || !drop.has(t.name));
  for (const name of drop) registry.toolOwners.delete(name);
}

const plugin = definePlugin({
  id: "tool-mcp",
  name: "MCP Tools",
  version: "0.1.0",
  register(api) {
    let manager: ReturnType<typeof createMcpManager> | undefined;
    const getManager = (logger: Parameters<typeof createMcpManager>[0]["logger"]) =>
      (manager ??= createMcpManager({
        connect: connectMcpServer,
        bridge: (serverId, connection) => bridgeMcpTools(serverId, connection.client),
        addTool: (tool) => api.registerTool(tool),
        removeTools: removeToolsFromRegistry,
        logger,
      }));

    api.registerService({
      id: "tool-mcp",
      // Deliberately does not wait for the servers: a slow or unreachable one
      // (e.g. blender-mcp with Blender closed) must not delay the gateway
      // listening. Tools show up as each server connects.
      start({ config, logger }) {
        getManager(logger).start(serversOf(config));
      },
      async stop() {
        await manager?.stop();
      },
    });

    api.registerGatewayMethod("mcp.status", async (_params, ctx) => ({
      servers: getManager(ctx.logger).status(serversOf(ctx.config)),
    }));

    // Apply the current config: connect new/changed servers, drop removed ones.
    api.registerGatewayMethod("mcp.reload", async (_params, ctx) => ({
      servers: await getManager(ctx.logger).reload(serversOf(ctx.config)),
    }));

    // Connect (or restart) one server and wait for the result — also the way
    // to start a server configured with autoStart: false.
    api.registerGatewayMethod("mcp.reconnect", async (params, ctx) => {
      const serverId = String(params.serverId ?? "");
      if (!serverId) throw new Error("mcp.reconnect: serverId required");
      const servers = serversOf(ctx.config);
      await getManager(ctx.logger).reconnect(serverId, servers);
      return { servers: getManager(ctx.logger).status(servers) };
    });

    api.registerGatewayMethod("mcp.disconnect", async (params, ctx) => {
      const serverId = String(params.serverId ?? "");
      if (!serverId) throw new Error("mcp.disconnect: serverId required");
      await getManager(ctx.logger).disconnect(serverId);
      return { servers: getManager(ctx.logger).status(serversOf(ctx.config)) };
    });
  },
});

export default plugin;
