import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";
import { chatReducer, initialChatState } from "./chatReducer.js";
import { useChatEvents } from "./useChatEvents.js";
import { MessageList } from "./MessageList.js";
import { ApprovalBar } from "./ApprovalBar.js";
import { AgentStatusBar } from "./AgentStatusBar.js";
import { deriveAgentStatus } from "./agentStatus.js";
import { fallbackReplyText } from "./fallbackReply.js";
import { useRecorder } from "../mic/useRecorder.js";
import { useSpeaker } from "../voice/useSpeaker.js";
import { SettingsView } from "../settings/SettingsView.js";
import type { AgentInfo, ChatFinalPayload, ChatSendResult, ProviderInfo } from "../types.js";
import type { SttSettings, WhisperSettings } from "../types.js";

const CHANNEL_ID = "avatar";
const ACCOUNT_ID = "default";

function newSessionKey(): string {
  return `${CHANNEL_ID}:${ACCOUNT_ID}:user-${crypto.randomUUID()}`;
}

export function ChatView() {
  const { call, onEvent } = useGateway();
  const [state, dispatch] = useReducer(chatReducer, undefined, initialChatState);
  const [showSettings, setShowSettings] = useState(false);
  const [textDraft, setTextDraft] = useState("");
  const [whisperSettings, setWhisperSettings] = useState<WhisperSettings | null>(null);
  const [sttSettings, setSttSettings] = useState<SttSettings | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const recorder = useRecorder();
  const speaker = useSpeaker();

  useChatEvents(onEvent, dispatch, state.sessionKey);

  const loadWhisperSettings = useCallback(async () => {
    const [whisper, stt] = await Promise.all([window.yggdrasil.whisper.getSettings(), window.yggdrasil.stt.getSettings()]);
    setWhisperSettings(whisper);
    setSttSettings(stt);
  }, []);

  // Separate subscription from useChatEvents — reading the final text out to
  // speak it is a distinct concern from folding it into chat state, and
  // multiple onEvent subscribers are fine (GatewayClient fans out to all of
  // them). Reads messages via a ref (rather than putting state.messages in
  // the deps array below) so this doesn't resubscribe on every delta/tool
  // message — only the ref needs to stay current, not the closure.
  const messagesRef = useRef(state.messages);
  messagesRef.current = state.messages;

  useEffect(() => {
    return onEvent((ev) => {
      if (ev.event !== "chat.final") return;
      const p = ev.payload as ChatFinalPayload;
      if (!p.sessionKey || p.sessionKey === state.sessionKey) {
        void speaker.speak(fallbackReplyText(p.text, messagesRef.current));
      }
    });
  }, [onEvent, state.sessionKey, speaker.speak]);

  useEffect(() => {
    (async () => {
      try {
        const [agentsRes, providersRes] = await Promise.all([
          call<{ agents: AgentInfo[]; defaultAgent: string }>("agents.list"),
          call<{ providers: ProviderInfo[] }>("providers.list"),
          loadWhisperSettings(),
          speaker.loadSettings(),
        ]);
        dispatch({ type: "SET_AGENTS", agents: agentsRes.agents, defaultAgent: agentsRes.defaultAgent });
        dispatch({ type: "SET_PROVIDERS", providers: providersRes.providers ?? [] });
        dispatch({ type: "SET_SESSION_KEY", sessionKey: newSessionKey() });
      } catch (err) {
        dispatch({
          type: "ADD_SYSTEM_MESSAGE",
          text: `Failed to load: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    })();
  }, [call, loadWhisperSettings, speaker.loadSettings]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !state.sessionKey) return;
      dispatch({ type: "ADD_USER_MESSAGE", text: trimmed });
      try {
        await call<ChatSendResult>(
          "chat.send",
          {
            message: trimmed,
            sessionKey: state.sessionKey,
            agentId: state.activeAgentId ?? undefined,
            channelId: CHANNEL_ID,
            accountId: ACCOUNT_ID,
            senderId: "user",
          },
          // Local models can be slow to start — this only bounds the RPC ack;
          // the reply itself always arrives via chat.delta/chat.final events.
          { timeoutMs: 180_000 },
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!message.startsWith("Timeout")) {
          dispatch({ type: "ADD_SYSTEM_MESSAGE", text: `Error: ${message}` });
        }
      }
    },
    [call, state.sessionKey, state.activeAgentId],
  );

  const onMicDown = useCallback(() => {
    setMicError(null);
    void recorder.start();
  }, [recorder]);

  const onMicUp = useCallback(async () => {
    const wav = await recorder.stop();
    if (!whisperSettings || !sttSettings) return;
    if (!wav) {
      setMicError("No audio captured — held for too short, or the mic hadn't started yet. Try again.");
      return;
    }
    const useCloud = sttSettings.source === "cloud";
    if (!useCloud && !whisperSettings.binaryPath) {
      setMicError("No whisper.cpp binary configured — set one in Settings → STT.");
      return;
    }
    try {
      const transcript = useCloud
        ? await window.yggdrasil.stt.transcribeCloud(wav, sttSettings.cloud)
        : await window.yggdrasil.whisper.transcribe(wav, whisperSettings);
      if (transcript) {
        setMicError(null);
        await send(transcript);
      } else {
        setMicError("Heard silence — no speech detected in that recording.");
      }
    } catch (err) {
      setMicError(err instanceof Error ? err.message : String(err));
    }
  }, [recorder, whisperSettings, sttSettings, send]);

  const respondToApproval = useCallback(
    (requestId: string, approved: boolean) => {
      void call("tools.approve", { requestId, approved });
    },
    [call],
  );

  const activeAgent = state.agents.find((a) => a.id === state.activeAgentId);
  const agentStatus = deriveAgentStatus(state, speaker.isSpeaking);

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Yggdrasil Avatar</h1>
        <div className="header-meta">
          {activeAgent && (
            <span className="muted">
              {activeAgent.label ?? activeAgent.id} · {activeAgent.provider ?? "?"}/{activeAgent.model ?? "default"}
            </span>
          )}
          <button type="button" onClick={() => setShowSettings(true)}>
            Settings
          </button>
        </div>
      </header>

      <AgentStatusBar status={agentStatus} />
      {speaker.isSpeaking && (
        <div className="speech-controls">
          {speaker.isPaused ? (
            <button type="button" onClick={speaker.resume}>Reanudar</button>
          ) : (
            <button type="button" onClick={speaker.pause}>Pausar</button>
          )}
          <button type="button" onClick={speaker.stop}>Detener</button>
        </div>
      )}

      <MessageList
        messages={state.messages}
        streamingText={state.streamingText}
        isStreaming={state.isStreaming}
        runningTools={state.runningTools}
      />

      {state.pendingApproval && <ApprovalBar approval={state.pendingApproval} onRespond={respondToApproval} />}

      {micError && <p className="error mic-error">{micError}</p>}
      {speaker.error && <p className="error mic-error">TTS: {speaker.error}</p>}

      <div className="composer">
        <button
          type="button"
          className={`mic-button ${recorder.status === "recording" ? "recording" : ""}`}
          onMouseDown={onMicDown}
          onMouseUp={() => void onMicUp()}
          onMouseLeave={() => recorder.status === "recording" && void onMicUp()}
          disabled={recorder.status === "processing"}
        >
          {recorder.status === "recording" ? "● Recording… release to send" : "🎙 Hold to talk"}
        </button>
        <form
          className="text-fallback"
          onSubmit={(e) => {
            e.preventDefault();
            void send(textDraft);
            setTextDraft("");
          }}
        >
          <input
            type="text"
            value={textDraft}
            onChange={(e) => setTextDraft(e.target.value)}
            placeholder="Or type a message…"
          />
          <button type="submit" disabled={!textDraft.trim()}>
            Send
          </button>
        </form>
      </div>

      {showSettings && (
        <SettingsView
          onClose={() => {
            setShowSettings(false);
            void loadWhisperSettings();
            void speaker.loadSettings();
          }}
        />
      )}
    </div>
  );
}
