import { friendlyError } from "../client/errors.js";
import type { ToolInfo, TurnLogEntry } from "../client/types.js";
import type { SlashCommand } from "./types.js";

export const infoCommands: SlashCommand[] = [
  {
    name: "tools",
    description: "List the tools the agent can use",
    async run({ client, state, dispatch }) {
      try {
        const { tools } = await client.call<{ tools: ToolInfo[] }>("tools.list", {
          sessionKey: state.sessionKey ?? undefined,
        });
        dispatch({ type: "SET_TOOLS", tools: [...tools].sort((a, b) => a.name.localeCompare(b.name)) });
        dispatch({ type: "PUSH_VIEW", mode: "tools" });
      } catch (err) {
        dispatch({ type: "ADD_SYSTEM_MESSAGE", text: `Failed to list tools: ${friendlyError(err)}` });
      }
    },
  },
  {
    name: "turns",
    description: "Recent turns on this gateway",
    async run({ client, dispatch }) {
      try {
        const { turns } = await client.call<{ turns: TurnLogEntry[] }>("turns.recent");
        dispatch({ type: "SET_TURNS", turns });
        dispatch({ type: "PUSH_VIEW", mode: "turns" });
      } catch (err) {
        dispatch({ type: "ADD_SYSTEM_MESSAGE", text: `Failed to load recent turns: ${friendlyError(err)}` });
      }
    },
  },
  {
    name: "status",
    description: "Show connection/session/agent status",
    run({ state, dispatch, gatewayUrl }) {
      const agent = state.agents.find((a) => a.id === (state.activeAgentId ?? state.defaultAgent));
      dispatch({
        type: "ADD_SYSTEM_MESSAGE",
        text: [
          `gateway: ${gatewayUrl}`,
          `session: ${state.sessionKey ?? "none"}`,
          `agent: ${agent?.id ?? "none"} (${agent?.provider ?? "?"}/${agent?.model ?? "?"})`,
          `connected: ${state.connected ? "yes" : "no"}`,
        ].join("\n"),
      });
    },
  },
];
