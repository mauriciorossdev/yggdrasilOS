import { defineSkill, defineTool } from "@yggdrasil/skills-sdk";

const exampleTool = defineTool({
  name: "{{PLUGIN_ID}}_hello",
  description: "Example tool from {{PLUGIN_ID}} skill",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Name to greet" },
    },
    required: ["name"],
  },
  async execute(_ctx, args) {
    return { greeting: `Hello, ${String(args.name)}!` };
  },
});

export default defineSkill({
  id: "{{PLUGIN_ID}}",
  name: "{{PLUGIN_LABEL}}",
  version: "0.1.0",
  instructions: `
# {{PLUGIN_LABEL}} skill

Describe what this skill enables the agent to do.

## Guidelines
- Add behavioral guidelines here
- These instructions are always present in the system prompt when the skill is active
`,
  tools: [exampleTool],
});
