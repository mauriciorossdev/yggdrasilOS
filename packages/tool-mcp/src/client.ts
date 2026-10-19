import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpServerConfig } from "@yggdrasil/config";
import { defineTool, type AgentToolDefinition } from "@yggdrasil/tools-sdk";

export type McpConnection = {
  serverId: string;
  client: Client;
  close(): Promise<void>;
};

// Some stdio MCP servers (e.g. blender-mcp, a Python process) print non-ASCII
// log output (accents, arrows) straight to stdout/stderr. On Windows those
// streams default to the console's legacy codepage (cp1252), not UTF-8 —
// writing an unencodable character there raises OSError and kills the
// process mid-connect, which then hangs connectMcpServer indefinitely (see
// CONNECT_TIMEOUT_MS below). Forcing UTF-8 here fixes it at the source
// instead of just timing out on the resulting hang.
const STDIO_UTF8_ENV = { PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" };

const CONNECT_TIMEOUT_MS = 10_000;

function createTransport(config: McpServerConfig): Transport {
  if (config.transport === "stdio") {
    return new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: { ...STDIO_UTF8_ENV, ...config.env },
    });
  }
  return new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: config.headers ? { headers: config.headers } : undefined,
  });
}

/**
 * A misbehaving server (crashed subprocess whose transport never surfaces a
 * clean close, an HTTP endpoint that never answers) can leave client.connect()
 * pending forever. tool-mcp's start() connects every configured server with
 * Promise.all and isolates each failure — but only once this rejects; without
 * a bound here, one bad server hangs the entire gateway boot (index.ts's
 * ensureGateway has its own 15s readiness timeout that this used to blow).
 */
export async function connectMcpServer(
  serverId: string,
  config: McpServerConfig,
): Promise<McpConnection> {
  const client = new Client({ name: "yggdrasil", version: "0.1.0" });
  await Promise.race([
    client.connect(createTransport(config)),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Timed out connecting to MCP server "${serverId}" after ${CONNECT_TIMEOUT_MS}ms`)),
        CONNECT_TIMEOUT_MS,
      ),
    ),
  ]);
  return { serverId, client, close: () => client.close() };
}

// Namespaced so tools from different MCP servers (or an MCP server and a
// built-in tool) can't collide on name — the tool-loop/registry key tools by
// name alone.
export function mcpToolName(serverId: string, toolName: string): string {
  return `mcp__${serverId}__${toolName}`;
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (part): part is { type: "text"; text: string } =>
        typeof part === "object" && part !== null && (part as { type?: unknown }).type === "text",
    )
    .map((part) => part.text)
    .join("\n");
}

export async function bridgeMcpTools(
  serverId: string,
  client: Client,
): Promise<AgentToolDefinition[]> {
  const { tools } = await client.listTools();
  return tools.map((tool) =>
    defineTool({
      name: mcpToolName(serverId, tool.name),
      description: tool.description ?? `MCP tool "${tool.name}" from server "${serverId}"`,
      parameters: {
        type: "object",
        ...(tool.inputSchema as Record<string, unknown>),
      } as AgentToolDefinition["parameters"],
      async execute(_ctx, args) {
        const result = await client.callTool({ name: tool.name, arguments: args });
        const text = extractText(result.content);
        if (result.isError) {
          throw new Error(text || `MCP tool "${tool.name}" failed`);
        }
        return text || result.content;
      },
    }),
  );
}
