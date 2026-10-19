import type { ChatToolDefinition } from "@yggdrasil/sdk";
import type { AgentToolDefinition } from "@yggdrasil/tools-sdk";

export function toolsToOpenAI(tools: AgentToolDefinition[]): ChatToolDefinition[] {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}
