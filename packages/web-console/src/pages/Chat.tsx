import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useGateway } from "@yggdrasil/client-web";
import {
  ApprovalBar,
  chatReducer,
  initialChatState,
  MessageList,
  useChatEvents,
  type AgentInfo,
  type ApprovalMode,
  type ChatMessage,
  type SessionInfo,
} from "@yggdrasil/ui-kit";
import { useT } from "../i18n";

/**
 * Chat with any session on this gateway — the console's own, the TUI's (`tui:*`) or the
 * desktop app's — using the same chat pieces as the app (@yggdrasil/ui-kit). A turn that
 * another client runs in the open session streams in live; when it ends, the session is
 * reloaded so that client's own message shows up too (there's no event for it).
 */

type SessionRecord = { sessionKey: string; title?: string; messages: Array<{ role: string; content: string; timestamp?: number }> };

const CHANNEL_ID = "web";
const ACCOUNT_ID = "default";

function newSessionKey(): string {
  return `${CHANNEL_ID}:${ACCOUNT_ID}:user-${crypto.randomUUID()}`;
}

/** Where a session was started, from its key's channel prefix. */
export function sessionOrigin(sessionKey: string): "tui" | "app" | "web" | "other" {
  const channel = sessionKey.split(":")[0];
  if (channel === "tui") return "tui";
  if (channel === "desktop" || channel === "agentflow") return "app";
  if (channel === "web") return "web";
  return "other";
}

function toMessages(record: SessionRecord): ChatMessage[] {
  return record.messages.map((m, i) => ({
    id: `resumed-${i}`,
    role: (m.role === "user" || m.role === "assistant" || m.role === "tool" ? m.role : "system") as ChatMessage["role"],
    text: m.content,
    timestamp: m.timestamp ?? Date.now(),
  }));
}

export function ChatPage() {
  const { call, onEvent, connected } = useGateway();
  const t = useT();
  const [params, setParams] = useSearchParams();
  const [state, dispatch] = useReducer(chatReducer, undefined, initialChatState);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  // True while a turn this page sent is running: its user message is already shown.
  const ownTurn = useRef(false);

  useChatEvents(onEvent, dispatch, state.sessionKey);

  const refreshSessions = useCallback(async () => {
    const res = await call<{ sessions: SessionInfo[] }>("sessions.list");
    dispatch({ type: "SET_SESSIONS", sessions: [...(res.sessions ?? [])].sort((a, b) => b.updatedAt - a.updatedAt) });
  }, [call]);

  const loadSession = useCallback(
    async (sessionKey: string) => {
      const res = await call<{ session: SessionRecord | null }>("sessions.get", { sessionKey });
      dispatch({ type: "LOAD_SESSION", sessionKey, messages: res.session ? toMessages(res.session) : [] });
      try {
        const { mode } = await call<{ mode: ApprovalMode }>("tools.approvalMode", { sessionKey });
        dispatch({ type: "SET_MODE", mode });
      } catch {
        // keep the mode shown
      }
    },
    [call],
  );

  // First load: agents, sessions, and the session in the URL (or a new one).
  useEffect(() => {
    if (!connected) return;
    void (async () => {
      const agents = await call<{ agents: AgentInfo[]; defaultAgent: string }>("agents.list");
      dispatch({ type: "SET_AGENTS", agents: agents.agents, defaultAgent: agents.defaultAgent });
      await refreshSessions();
    })();
  }, [connected, call, refreshSessions]);

  const selected = params.get("session");
  useEffect(() => {
    if (!connected) return;
    if (selected) void loadSession(selected);
    else dispatch({ type: "LOAD_SESSION", sessionKey: newSessionKey(), messages: [] });
  }, [connected, selected, loadSession]);

  // Another client's turn in this session: reload it when it ends. Any turn: refresh the list.
  useEffect(() => {
    return onEvent((ev) => {
      if (ev.event !== "chat.final") return;
      const p = ev.payload as { sessionKey?: string };
      void refreshSessions();
      if (p.sessionKey && p.sessionKey === state.sessionKey && !ownTurn.current) void loadSession(p.sessionKey);
      if (p.sessionKey === state.sessionKey) ownTurn.current = false;
    });
  }, [onEvent, refreshSessions, loadSession, state.sessionKey]);

  const send = async () => {
    const text = input.trim();
    if (!text || !state.sessionKey || sending) return;
    setInput("");
    setSending(true);
    ownTurn.current = true;
    dispatch({ type: "ADD_USER_MESSAGE", text });
    try {
      await call(
        "chat.send",
        {
          message: text,
          sessionKey: state.sessionKey,
          agentId: state.activeAgentId ?? undefined,
          channelId: CHANNEL_ID,
          accountId: ACCOUNT_ID,
          senderId: "user",
        },
        { timeoutMs: 180_000 },
      );
      if (!params.get("session")) setParams({ session: state.sessionKey }, { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // A timed-out ack isn't a failed turn: the reply still arrives as events.
      if (!message.startsWith("Timeout:")) dispatch({ type: "ADD_SYSTEM_MESSAGE", text: t("chat.error", { message }) });
      ownTurn.current = false;
    } finally {
      setSending(false);
      void refreshSessions();
    }
  };

  const respondApproval = (requestId: string, approved: boolean) => {
    void call("tools.approve", { requestId, approved });
  };

  const runningTools = [...state.toolCalls.values()].filter((c) => c.status === "running").map((c) => c.toolName);
  const current = state.sessions.find((s) => s.sessionKey === state.sessionKey);

  return (
    <div className="page chat-page chat-with-sessions">
      <aside className="session-picker card">
        <button type="button" onClick={() => setParams({})}>
          {t("chat.new")}
        </button>
        <ul>
          {state.sessions.map((s) => (
            <li key={s.sessionKey}>
              <button
                type="button"
                className={`session-item${s.sessionKey === state.sessionKey ? " active" : ""}`}
                onClick={() => setParams({ session: s.sessionKey })}
                title={s.sessionKey}
              >
                <span className={`origin-tag origin-${sessionOrigin(s.sessionKey)}`}>{t(`chat.origin.${sessionOrigin(s.sessionKey)}`)}</span>
                <span className="session-title">{s.title || s.sessionKey}</span>
                <span className="muted session-meta">{t("chat.messages", { count: s.messageCount })}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section className="chat-main">
        <header className="chat-header">
          <div>
            <strong>{current?.title || (selected ? state.sessionKey : t("chat.newSession"))}</strong>
            <span className="muted chat-mode">{t("chat.mode", { mode: state.mode })}</span>
          </div>
          <select
            aria-label={t("chat.agent")}
            value={state.activeAgentId ?? state.defaultAgent ?? ""}
            onChange={(e) => dispatch({ type: "SET_ACTIVE_AGENT", agentId: e.target.value })}
          >
            {state.agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label ?? a.id}
              </option>
            ))}
          </select>
        </header>
        <div className="chat-log">
          <MessageList
            messages={state.messages}
            streamingText={state.streamingText}
            isStreaming={state.isStreaming}
            isTurnActive={state.isTurnActive}
            runningTools={runningTools}
          />
        </div>
        {state.pendingApproval && (
          <ApprovalBar key={state.pendingApproval.requestId} approval={state.pendingApproval} onRespond={respondApproval} />
        )}
        <form
          className="chat-input"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("chat.placeholder")}
            disabled={sending || !!state.pendingApproval}
          />
          <button type="submit" disabled={sending || !input.trim() || !!state.pendingApproval}>
            {t("chat.send")}
          </button>
        </form>
      </section>
    </div>
  );
}
