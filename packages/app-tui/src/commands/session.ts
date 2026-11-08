import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildSessionKey } from "@yggdrasil/config";
import { friendlyError } from "../client/errors.js";
import type { SessionInfo } from "../client/types.js";
import type { SlashCommand } from "./types.js";

export const sessionCommands: SlashCommand[] = [
  {
    name: "reset",
    description: "Clear session history",
    async run({ client, state, dispatch }) {
      await client.call("sessions.reset", { sessionKey: state.sessionKey });
      dispatch({ type: "RESET_MESSAGES" });
    },
  },
  {
    name: "new",
    description: "Start a new isolated session",
    run({ senderIdPrefix, dispatch }) {
      const newKey = buildSessionKey("tui", "default", `${senderIdPrefix ?? "local"}-${randomUUID()}`);
      dispatch({ type: "SET_SESSION_KEY", sessionKey: newKey });
      dispatch({ type: "RESET_MESSAGES" });
      dispatch({ type: "SET_MODE", mode: "auto" });
    },
  },
  {
    name: "sessions",
    description: "List all sessions (r renames the selected one)",
    async run({ client, dispatch }) {
      const { sessions } = await client.call<{ sessions: SessionInfo[] }>("sessions.list");
      dispatch({ type: "SET_SESSIONS", sessions });
      dispatch({ type: "PUSH_VIEW", mode: "sessions" });
    },
  },
  {
    name: "rename",
    usage: "rename <title>",
    description: "Rename the current session",
    noPalette: true,
    async run({ state, dispatch, renameSession }, args) {
      if (!args) {
        dispatch({ type: "ADD_SYSTEM_MESSAGE", text: "Usage: /rename <title>" });
      } else if (state.sessionKey) {
        await renameSession(state.sessionKey, args);
      }
    },
  },
  {
    name: "compact",
    description: "Force session compaction now",
    async run({ client, state, dispatch }) {
      if (!state.sessionKey) return;
      try {
        const { compacted, before, after } = await client.call<{ compacted: boolean; before: number; after: number }>(
          "sessions.compact",
          { sessionKey: state.sessionKey, agentId: state.activeAgentId },
        );
        dispatch({
          type: "ADD_SYSTEM_MESSAGE",
          text: compacted ? `✓ Compacted: ${before} → ${after} messages` : "Nothing to compact",
        });
      } catch (err) {
        dispatch({ type: "ADD_SYSTEM_MESSAGE", text: `✗ Compact failed: ${friendlyError(err)}` });
      }
    },
  },
  {
    name: "export",
    description: "Export session transcript to markdown",
    async run({ client, state, dispatch, cwd }) {
      if (!state.sessionKey) return;
      const sessionKey = state.sessionKey;
      try {
        const { session } = await client.call<{
          session: { messages: Array<{ role: string; content: string }> } | null;
        }>("sessions.get", { sessionKey });
        if (!session) {
          dispatch({ type: "ADD_SYSTEM_MESSAGE", text: "✗ No session to export" });
          return;
        }
        const body = session.messages.map((m) => `## ${m.role}\n\n${m.content}\n`).join("\n");
        const path = join(cwd, `yggdrasil-session-${sessionKey.slice(-8)}-${Date.now()}.md`);
        await writeFile(path, body, "utf8");
        dispatch({ type: "ADD_SYSTEM_MESSAGE", text: `✓ Exported to ${path}` });
      } catch (err) {
        dispatch({ type: "ADD_SYSTEM_MESSAGE", text: `✗ Export failed: ${friendlyError(err)}` });
      }
    },
  },
];
