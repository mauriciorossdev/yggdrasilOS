import type { AgentToolDefinition, ToolContext } from "@yggdrasil/tools-sdk";

const tools = new Map<string, AgentToolDefinition>();

export function registerToolDefinition(def: AgentToolDefinition): void {
  tools.set(def.name, def);
}

export function clearToolRegistry(): void {
  tools.clear();
}

export function listTools(): AgentToolDefinition[] {
  return [...tools.values()];
}

export function getTool(name: string): AgentToolDefinition | undefined {
  return tools.get(name);
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  const tool = getTool(name);
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }
  return tool.execute(ctx, args);
}
