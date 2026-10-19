import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";
import { chatReducer, initialChatState } from "../chat/chatReducer.js";
import { useChatEvents } from "../chat/useChatEvents.js";
import { MessageList } from "../chat/MessageList.js";
import { ApprovalBar } from "../chat/ApprovalBar.js";
import { ChatInput } from "../chat/ChatInput.js";
import { studioChatContext } from "./studioContext.js";
import type { AgentInfo, Attachment, ChatSendResult, PluginRecord } from "../types.js";

const CHANNEL_ID = "desktop";
const ACCOUNT_ID = "default";

type Props = { plugin: PluginRecord };

/**
 * A fully self-contained chat session scoped to one complemento — its own
 * `chatReducer` instance and its own `sessionKey`, safe alongside the main
 * Chat tab's own session because every gateway event carries a `sessionKey`
 * and `useChatEvents`'s own filtering (`matchesSession`) keys off it, so
 * this instance never sees (or is seen by) the main tab's events.
 *
 * Fetches the current agent list itself (`agents.list`) rather than taking
 * it as a prop — keeps StudioView/StudioWorkspace from needing to know
 * anything about chat internals, matching the rest of Estudio's
 * self-contained-component convention.
 */
export function StudioChatPane({ plugin }: Props) {
  const { call, onEvent } = useGateway();
  const [state, dispatch] = useReducer(chatReducer, undefined, initialChatState);
  const [attachedFiles, setAttachedFiles] = useState<Attachment[]>([]);
  // Reset per plugin.key change — see the init effect below.
  const firstMessageSentRef = useRef(false);

  useChatEvents(onEvent, dispatch, state.sessionKey);

  useEffect(() => {
    firstMessageSentRef.current = false;
    (async () => {
      try {
        const agentsRes = await call<{ agents: AgentInfo[]; defaultAgent: string }>("agents.list");
        dispatch({ type: "SET_AGENTS", agents: agentsRes.agents, defaultAgent: agentsRes.defaultAgent });
        const sessionKey = `${CHANNEL_ID}:${ACCOUNT_ID}:studio-${plugin.key}-${crypto.randomUUID()}`;
        dispatch({ type: "SET_SESSION_KEY", sessionKey });
      } catch (err) {
        dispatch({
          type: "ADD_SYSTEM_MESSAGE",
          text: `No se pudo iniciar el chat: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    })();
    // Deliberately keyed only on plugin.key — a brand-new session per
    // selected plugin, not re-triggered by unrelated state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plugin.key]);

  const send = useCallback(
    async (text: string) => {
      if (!state.sessionKey) return;
      const outgoing = firstMessageSentRef.current ? text : `${studioChatContext(plugin)}${text}`;
      firstMessageSentRef.current = true;
      dispatch({ type: "ADD_USER_MESSAGE", text });
      try {
        await call<ChatSendResult>(
          "chat.send",
          {
            message: outgoing,
            sessionKey: state.sessionKey,
            agentId: state.activeAgentId ?? undefined,
            channelId: CHANNEL_ID,
            accountId: ACCOUNT_ID,
            senderId: "user",
          },
          { timeoutMs: 180_000 },
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!message.startsWith("Timeout:")) {
          dispatch({ type: "ADD_SYSTEM_MESSAGE", text: `Error: ${message}` });
        }
      }
    },
    [call, state.sessionKey, state.activeAgentId, plugin],
  );

  const respondApproval = useCallback(
    (requestId: string, approved: boolean) => {
      void call("tools.approve", { requestId, approved });
    },
    [call],
  );

  const runningTools = [...state.toolCalls.values()].filter((t) => t.status === "running").map((t) => t.toolName);

  return (
    <div className="studio-chat-pane">
      <MessageList
        messages={state.messages}
        streamingText={state.streamingText}
        isStreaming={state.isStreaming}
        isTurnActive={state.isTurnActive}
        runningTools={runningTools}
      />
      {state.pendingApproval && <ApprovalBar approval={state.pendingApproval} onRespond={respondApproval} />}
      <ChatInput
        disabled={!state.sessionKey || !!state.pendingApproval}
        isStreaming={state.isStreaming}
        onSend={(t) => void send(t)}
        onStop={() => void call("chat.stop", { sessionKey: state.sessionKey })}
        attachments={attachedFiles}
        onAttach={(a) =>
          setAttachedFiles((prev) => (prev.some((x) => x.relativePath === a.relativePath) ? prev : [...prev, a]))
        }
        onRemoveAttachment={(p) => setAttachedFiles((prev) => prev.filter((a) => a.relativePath !== p))}
      />
    </div>
  );
}
