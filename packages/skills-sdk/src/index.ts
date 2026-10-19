import { definePlugin, type YggdrasilPlugin } from "@yggdrasil/sdk";
import type { AgentToolDefinition } from "@yggdrasil/tools-sdk";
import type { ContextBlock } from "@yggdrasil/context-sdk";

export type { AgentToolDefinition };
export { defineTool } from "@yggdrasil/tools-sdk";

export type SkillDefinition = {
  id: string;
  name: string;
  version?: string;
  /** Markdown injected into system prompt when skill is active */
  instructions?: string;
  /** Tools provided by this skill */
  tools?: AgentToolDefinition[];
};

export function defineSkill(def: SkillDefinition): YggdrasilPlugin {
  return definePlugin({
    id: def.id,
    name: def.name,
    version: def.version ?? "0.1.0",
    register(api) {
      for (const tool of def.tools ?? []) {
        api.registerTool(tool);
      }

      if (def.instructions?.trim()) {
        const content = def.instructions.trim();
        api.registerContextProvider({
          id: `${def.id}:instructions`,
          label: `${def.name} instructions`,
          priority: 5,
          assemble(): Promise<ContextBlock[]> {
            return Promise.resolve([
              {
                role: "system",
                content,
                source: def.id,
                priority: 5,
                cacheable: true,
                ttlMs: 300_000,
              },
            ]);
          },
        });
      }

      api.logger.info("registered skill", { id: def.id, tools: (def.tools ?? []).map((t) => t.name) });
    },
  });
}
