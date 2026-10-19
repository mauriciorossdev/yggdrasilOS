import { defineTool } from "@yggdrasil/tools-sdk";
import { createAgent } from "@yggdrasil/config";
import { getKernelContext } from "@yggdrasil/kernel";

export const createAgentTool = defineTool({
  name: "create_agent",
  description:
    "Creates a new named agent persona (an id, an optional label, a system prompt, and optionally a " +
    "provider/model) that the user can later select and chat with. Use this when the user asks you to " +
    'create, define, or set up a new agent/persona/assistant for some purpose (e.g. "create an agent ' +
    'that reviews my Python code"). The systemPrompt you write should be the actual instructions for ' +
    "that agent's behavior. IMPORTANT: before calling this tool, you must always explicitly ask the user " +
    "whether the new agent should be local to the current project (only usable here) or global " +
    "(persists and is usable across all their projects) — there is no default, and you must not guess. " +
    'Pass their answer as the scope parameter, exactly "local" or "global".',
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: 'Short unique identifier for the agent, e.g. "code-reviewer". No spaces.' },
      label: { type: "string", description: 'Human-friendly display name, e.g. "Code Reviewer". Optional.' },
      systemPrompt: {
        type: "string",
        description: "The system prompt defining this agent's behavior and purpose. Required.",
      },
      provider: {
        type: "string",
        description: 'Provider id to use, e.g. "openai-compat". Optional — omit to use the platform default.',
      },
      model: { type: "string", description: "Model id to use. Optional — omit to use the platform default." },
      scope: {
        type: "string",
        description:
          'Either "local" (saved to this project only) or "global" (saved under the user\'s home ' +
          "directory, usable from any project). You must ask the user which one they want before calling " +
          "this tool — never choose on their behalf.",
      },
    },
    required: ["id", "systemPrompt", "scope"],
  },
  riskLevel: "destructive",
  async execute(_ctx, args) {
    const id = String(args.id ?? "").trim();
    const systemPrompt = String(args.systemPrompt ?? "").trim();
    const scope = args.scope;
    if (!id) throw new Error("create_agent: id is required");
    if (!systemPrompt) throw new Error("create_agent: systemPrompt is required");
    if (scope !== "local" && scope !== "global") {
      throw new Error(
        `create_agent: scope must be exactly "local" or "global" — ask the user which one they want. Got: ${JSON.stringify(scope)}`,
      );
    }

    const workspaceRoot = getKernelContext()?.workspaceRoot;

    const created = await createAgent({
      agent: {
        id,
        label: args.label !== undefined ? String(args.label) : undefined,
        systemPrompt,
        provider: args.provider !== undefined ? String(args.provider) : undefined,
        model: args.model !== undefined ? String(args.model) : undefined,
      },
      scope,
      workspaceRoot,
    });

    return {
      created: true,
      id: created.id,
      scope: created.scope,
      note: "The agent is available immediately in this session. Restart may be needed for other running clients to see it.",
    };
  },
});
