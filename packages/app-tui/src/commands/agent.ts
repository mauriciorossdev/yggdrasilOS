import type { AgentInfo } from "../client/types.js";
import type { SlashCommand } from "./types.js";

export const agentCommands: SlashCommand[] = [
  {
    name: "agents",
    description: "Manage agents (view, switch, create)",
    async run({ client, dispatch, showAgentForm }) {
      const { agents, defaultAgent } = await client.call<{ agents: AgentInfo[]; defaultAgent: string }>("agents.list");
      dispatch({ type: "SET_AGENTS", agents, defaultAgent });
      showAgentForm(false);
      dispatch({ type: "PUSH_VIEW", mode: "agents" });
    },
  },
  {
    name: "agent",
    usage: "agent <id>",
    description: "Switch active agent",
    noPalette: true, // the palette lists one entry per agent instead
    run({ dispatch }, args) {
      const agentId = args.split(/\s+/)[0];
      if (agentId) dispatch({ type: "SET_ACTIVE_AGENT", agentId });
    },
  },
  {
    name: "model",
    description: "Jump to model selector",
    run({ state, dispatch, openModelPicker }) {
      const agent = state.agents.find((a) => a.id === (state.activeAgentId ?? state.defaultAgent));
      if (agent?.provider) openModelPicker(agent.provider);
      dispatch({ type: "PUSH_VIEW", mode: "config" });
    },
  },
  {
    name: "config",
    description: "Open configuration menu",
    run({ dispatch }) {
      dispatch({ type: "PUSH_VIEW", mode: "config" });
    },
  },
];
