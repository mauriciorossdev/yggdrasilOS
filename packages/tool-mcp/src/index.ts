import type { YggdrasilConfig } from "@yggdrasil/config";
import { definePlugin } from "@yggdrasil/sdk";
import { bridgeMcpTools, connectMcpServer, type McpConnection } from "./client.js";

export type McpServerStatus = {
  id: string;
  connected: boolean;
  toolCount: number;
  tools: string[];
  error?: string;
};

const plugin = definePlugin({
  id: "tool-mcp",
  name: "MCP Tools",
  version: "0.1.0",
  register(api) {
    const connections: McpConnection[] = [];
    // Populated once per server during service start — mcp.status just
    // reads this back rather than re-querying live connections, so it stays
    // cheap to poll from Settings.
    const status = new Map<string, McpServerStatus>();

    api.registerService({
      id: "tool-mcp",
      async start({ config, logger }) {
        const servers = (config as YggdrasilConfig).mcpServers ?? {};
        status.clear();

        await Promise.all(
          Object.entries(servers).map(async ([serverId, serverConfig]) => {
            try {
              const connection = await connectMcpServer(serverId, serverConfig);
              connections.push(connection);

              const tools = await bridgeMcpTools(serverId, connection.client);
              for (const tool of tools) {
                api.registerTool(tool);
              }
              status.set(serverId, {
                id: serverId,
                connected: true,
                toolCount: tools.length,
                tools: tools.map((t) => t.name),
              });
              logger.info("connected MCP server", { serverId, tools: tools.length });
            } catch (err) {
              const error = err instanceof Error ? err.message : String(err);
              status.set(serverId, { id: serverId, connected: false, toolCount: 0, tools: [], error });
              logger.error("failed to connect MCP server", { serverId, error });
            }
          }),
        );
      },
      async stop() {
        await Promise.all(connections.map((c) => c.close().catch(() => {})));
        connections.length = 0;
      },
    });

    api.registerGatewayMethod("mcp.status", async () => ({
      servers: [...status.values()],
    }));
  },
});

export default plugin;
