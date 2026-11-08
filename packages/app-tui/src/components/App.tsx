import { randomUUID } from "node:crypto";
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Box, Text, useApp } from "ink";
import { buildSessionKey } from "@yggdrasil/config";
import { theme } from "../render/theme.js";
import { ConnectionLostError, GatewayClient } from "../client/gateway-client.js";
import { friendlyError } from "../client/errors.js";
import { useReconnectRecovery } from "../hooks/useReconnectRecovery.js";
import type { AgentInfo, ApprovalMode, ConfigGetResult, ProviderInfo, SessionInfo } from "../client/types.js";
import { initialState, tuiReducer } from "../state/store.js";
import { useGatewayEvents } from "../hooks/useGatewayEvents.js";
import { useKeybinds } from "../hooks/useKeybinds.js";
import { toChatMessages } from "../state/sessionMessages.js";
import { MessageList } from "./MessageList.js";
import { InputBox } from "./InputBox.js";
import { StatusBar } from "./StatusBar.js";
import { ApprovalPrompt } from "./ApprovalPrompt.js";
import { CommandPalette, type Command } from "./CommandPalette.js";
import { ConfigMenu } from "./config/ConfigMenu.js";
import { SessionList } from "./SessionList.js";
import { buildPaletteCommands, runSlash, type CommandContext } from "../commands/index.js";
import { ToolsList } from "./ToolsList.js";
import { TurnsList } from "./TurnsList.js";
import { loadInputHistory, saveInputHistory } from "../state/inputHistoryStore.js";
import { AgentsList } from "./AgentsList.js";
import { AgentForm } from "./AgentForm.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { setMarkdownWidth } from "../render/markdown.js";
import { SlashAutocomplete, getSlashSuggestions } from "./SlashAutocomplete.js";
import type { ChatMessage } from "../state/store.js";
import { runLocalCommand } from "../shell/run-local-command.js";

const MODE_ORDER: ApprovalMode[] = ["auto", "plan", "restrict", "yolo"];

type Props = {
  gatewayUrl: string;
  senderIdPrefix?: string;
  continueSession?: boolean;
  initialAgentId?: string;
  /** Join this exact session instead of minting a fresh "tui:default:..." one — used by Agent Flow's "Run Flow" so the pane shows the live autonomous conversation. */
  initialSessionKey?: string;
  /** Autonomous run owns this session — block a human from sending a second, concurrent chat.send into it. */
  readOnly?: boolean;
  /** Approval mode to start the session in; applied on the gateway right after connecting. */
  initialMode?: ApprovalMode;
  /** Model id sent with every chat.send as the override for the agent's own. */
  modelOverride?: string;
  /** Gateway API key; falls back to YGGDRASIL_API_KEY. */
  apiKey?: string;
};

export function App({
  gatewayUrl,
  senderIdPrefix,
  continueSession,
  initialAgentId,
  initialSessionKey,
  readOnly,
  initialMode,
  modelOverride,
  apiKey,
}: Props): React.ReactElement {
  const { exit } = useApp();
  const [state, dispatch] = useReducer(tuiReducer, undefined, initialState);
  const [currentInput, setCurrentInput] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);
  const [skillCommands, setSkillCommands] = useState<Array<{ name: string; description: string; prompt: string }>>([]);
  const [configInitialView, setConfigInitialView] = useState<
    { view: "model"; providerId: string } | undefined
  >(undefined);
  const [showAgentForm, setShowAgentForm] = useState(false);
  const clientRef = useRef<GatewayClient | null>(null);

  if (!clientRef.current) {
    clientRef.current = new GatewayClient(gatewayUrl, { apiKey });
  }
  const client = clientRef.current;

  const termSize = useTerminalSize();
  setMarkdownWidth(termSize.columns - 4);

  useGatewayEvents(client, dispatch, state.sessionKey);
  useReconnectRecovery(client, dispatch, state.sessionKey, state.mode);

  const handleCycleMode = useCallback(() => {
    const next = MODE_ORDER[(MODE_ORDER.indexOf(state.mode) + 1) % MODE_ORDER.length]!;
    dispatch({ type: "SET_MODE", mode: next });
    if (state.sessionKey) {
      void client.call("tools.setApprovalMode", { sessionKey: state.sessionKey, mode: next }).catch((err) => {
        dispatch({
          type: "ADD_SYSTEM_MESSAGE",
          text: `Failed to change mode: ${err instanceof Error ? err.message : String(err)}`,
        });
      });
    }
  }, [client, state.mode, state.sessionKey]);

  const canCancel = !readOnly && (state.isTurnActive || state.isStreaming) && !state.isCancelling;
  const handleCancel = useCallback(() => {
    if (!state.sessionKey) return;
    dispatch({ type: "CANCEL_REQUESTED" });
    client.call<{ cancelled: boolean }>("chat.cancel", { sessionKey: state.sessionKey }).then(
      (res) => {
        // Nothing was running server-side (the turn finished a moment ago): don't stay stuck on "cancelling…".
        if (!res.cancelled) dispatch({ type: "CANCEL_SETTLED" });
      },
      (err) => {
        dispatch({
          type: "ADD_SYSTEM_MESSAGE",
          text: `Failed to cancel: ${err instanceof Error ? err.message : String(err)}`,
        });
      },
    );
  }, [client, state.sessionKey]);

  useKeybinds(
    dispatch,
    state.viewMode,
    () => {
      client.disconnect();
      exit();
    },
    handleCycleMode,
    handleCancel,
    canCancel,
  );

  useEffect(() => {
    let disposed = false;

    async function init(): Promise<void> {
      try {
        await client.connect();
        dispatch({ type: "SET_CONNECTED", connected: true });

        const prefix = senderIdPrefix ?? "local";
        let sessionKey: string | undefined;
        let resumedMessages: ChatMessage[] = [];

        if (initialSessionKey) {
          // Join a specific session (Agent Flow's "Run Flow") rather than
          // minting our own — hydrate whatever history already exists for
          // it (there may be none yet, if the pane connects before the
          // turn that owns this key has produced anything).
          sessionKey = initialSessionKey;
          const { session } = await client.call<{
            session: { messages: Array<{ role: string; content: string; timestamp?: number }> } | null;
          }>("sessions.get", { sessionKey });
          if (session) {
            resumedMessages = toChatMessages(session.messages);
          }
        } else if (continueSession) {
          const { sessions } = await client.call<{ sessions: SessionInfo[] }>("sessions.list");
          const match = sessions.find((s) => s.sessionKey.startsWith(`tui:default:${prefix}-`));
          if (match) {
            const { session } = await client.call<{
              session: { messages: Array<{ role: string; content: string; timestamp?: number }> } | null;
            }>("sessions.get", { sessionKey: match.sessionKey });
            if (session) {
              sessionKey = match.sessionKey;
              resumedMessages = toChatMessages(session.messages);
            }
          }
        }

        if (!sessionKey) {
          sessionKey = buildSessionKey("tui", "default", `${prefix}-${randomUUID()}`);
        }

        if (resumedMessages.length > 0) {
          dispatch({ type: "LOAD_SESSION", sessionKey, messages: resumedMessages });
        } else {
          dispatch({ type: "SET_SESSION_KEY", sessionKey });
        }

        try {
          if (initialMode) {
            await client.call("tools.setApprovalMode", { sessionKey, mode: initialMode });
            dispatch({ type: "SET_MODE", mode: initialMode });
          } else {
            const { mode } = await client.call<{ mode: ApprovalMode }>("tools.approvalMode", { sessionKey });
            dispatch({ type: "SET_MODE", mode });
          }
        } catch {
          // non-fatal — keep the local "auto" default
        }

        const [agentsResult, providersResult, configResult, skillCmdsResult] = await Promise.all([
          client.call<{ agents: AgentInfo[]; defaultAgent: string }>("agents.list"),
          client.call<{ providers: ProviderInfo[] }>("providers.list"),
          client.call<ConfigGetResult>("config.get"),
          client.call<{ commands: Array<{ name: string; description: string; prompt: string }> }>("skills.commands").catch(() => ({ commands: [] })),
        ]);

        if (disposed) return;

        dispatch({
          type: "SET_AGENTS",
          agents: agentsResult.agents,
          defaultAgent: agentsResult.defaultAgent,
        });
        if (initialAgentId && agentsResult.agents.some((a) => a.id === initialAgentId)) {
          dispatch({ type: "SET_ACTIVE_AGENT", agentId: initialAgentId });
        }
        dispatch({ type: "SET_PROVIDERS", providers: providersResult.providers });
        dispatch({
          type: "SET_CONFIG",
          config: configResult.config,
          configPath: configResult.configPath,
        });
        dispatch({ type: "SET_WORKSPACE", workspaceRoot: configResult.workspaceRoot });
        if (!disposed && skillCmdsResult.commands.length > 0) {
          setSkillCommands(skillCmdsResult.commands);
        }
      } catch (err) {
        if (!disposed) {
          dispatch({ type: "SET_CONNECTION_ERROR", error: friendlyError(err) });
        }
      }
    }

    void init();

    return () => {
      disposed = true;
      client.disconnect();
    };
  }, [client]);

  // Input history survives restarts: loaded once, then written back whenever it changes.
  const historyLoaded = useRef(false);
  useEffect(() => {
    let cancelled = false;
    void loadInputHistory().then((entries) => {
      if (cancelled) return;
      historyLoaded.current = true;
      dispatch({ type: "LOAD_INPUT_HISTORY", entries });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (historyLoaded.current) void saveInputHistory(state.inputHistory);
  }, [state.inputHistory]);

  const handleSendMessage = useCallback(
    async (text: string) => {
      if (text.startsWith("/")) {
        void runSlash(text, commandContextRef.current);
        return;
      }

      if (text.startsWith("!")) {
        handleShellCommand(text);
        return;
      }

      dispatch({ type: "ADD_USER_MESSAGE", text });
      dispatch({ type: "PUSH_INPUT_HISTORY", text });

      try {
        await client.call(
          "chat.send",
          {
            message: text,
            sessionKey: state.sessionKey,
            agentId: state.activeAgentId,
            channelId: "tui",
            ...(modelOverride ? { model: modelOverride } : {}),
          },
          // Local/slow models can take minutes per turn — the RPC ack just
          // confirms the gateway accepted the message; the actual reply
          // arrives later via turn.start/turn.end + chat events regardless
          // of this promise, so give it plenty of room before giving up.
          10 * 60_000,
        );
      } catch (err) {
        if (err instanceof ConnectionLostError) {
          // The gateway may well still be working on the turn; the reconnect handler reloads the session.
          dispatch({ type: "ADD_SYSTEM_MESSAGE", text: "Connection lost while waiting for the reply — reconnecting…" });
          return;
        }
        dispatch({
          type: "ADD_SYSTEM_MESSAGE",
          text: `Failed to send message: ${friendlyError(err)}`,
        });
      }
    },
    [client, state.sessionKey, state.activeAgentId, modelOverride],
  );

  const renameSession = useCallback(
    async (sessionKey: string, title: string) => {
      try {
        await client.call("sessions.patch", { sessionKey, title });
        if (sessionKey === state.sessionKey) dispatch({ type: "SET_SESSION_TITLE", title });
        const { sessions } = await client.call<{ sessions: SessionInfo[] }>("sessions.list");
        dispatch({ type: "SET_SESSIONS", sessions });
        dispatch({ type: "ADD_SYSTEM_MESSAGE", text: `Session renamed to "${title}".` });
      } catch (err) {
        dispatch({ type: "ADD_SYSTEM_MESSAGE", text: `Rename failed: ${friendlyError(err)}` });
      }
    },
    [client, state.sessionKey],
  );

  const handleShellCommand = useCallback((text: string) => {
    dispatch({ type: "ADD_USER_MESSAGE", text });
    dispatch({ type: "PUSH_INPUT_HISTORY", text });

    const command = text.slice(1).trim();
    if (!command) {
      dispatch({ type: "ADD_SYSTEM_MESSAGE", text: "Usage: !<command>" });
      return;
    }

    void runLocalCommand(command, process.cwd())
      .then(({ stdout, stderr, exitCode, timedOut }) => {
        const parts = [stdout.trim(), stderr.trim()].filter(Boolean);
        if (timedOut) {
          parts.push("[timed out]");
        } else if (exitCode !== 0) {
          parts.push(`[exit ${exitCode ?? "?"}]`);
        }
        dispatch({
          type: "ADD_SYSTEM_MESSAGE",
          text: parts.length > 0 ? parts.join("\n") : "(no output)",
        });
      })
      .catch((err) => {
        dispatch({
          type: "ADD_SYSTEM_MESSAGE",
          text: `✗ Command failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      });
  }, []);

  const handleApprovalResponse = useCallback(
    (requestId: string, approved: boolean) => {
      void client.call("tools.approve", { requestId, approved });
    },
    [client],
  );

  // Slash commands are plain functions over this context (see ../commands); the ref keeps
  // handlers that were created earlier pointed at the latest state.
  const commandContext: CommandContext = {
    client,
    state,
    dispatch,
    gatewayUrl,
    senderIdPrefix,
    cwd: process.cwd(),
    skills: skillCommands,
    exit: () => {
      client.disconnect();
      exit();
    },
    renameSession,
    showAgentForm: setShowAgentForm,
    openModelPicker: (providerId) => setConfigInitialView({ view: "model", providerId }),
    sendMessage: (text) => void handleSendMessage(text),
  };
  const commandContextRef = useRef(commandContext);
  commandContextRef.current = commandContext;

  const commands: Command[] = useMemo(
    () => buildPaletteCommands(commandContextRef.current),
    // The palette only needs rebuilding when what it lists changes; actions read the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.agents, skillCommands],
  );

  const slashSuggestions = useMemo(
    () => getSlashSuggestions(currentInput, commands),
    [currentInput, commands],
  );

  useEffect(() => {
    setSlashIndex(0);
  }, [currentInput]);

  const handleConfigChanged = useCallback(() => {
    void client.call<ConfigGetResult>("config.get").then((result) => {
      dispatch({ type: "SET_CONFIG", config: result.config, configPath: result.configPath });
    });
    void client
      .call<{ providers: ProviderInfo[] }>("providers.list")
      .then(({ providers }) => {
        dispatch({ type: "SET_PROVIDERS", providers });
      });
  }, [client]);

  if (!state.connected) {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        {state.connectionError ? (
          <Text color={theme.error ?? "red"}>
            Gateway error: {state.connectionError}{"\n"}
            <Text dimColor>Try: kill $(lsof -t -i:18789) then restart</Text>
          </Text>
        ) : (
          <Text color={theme.warning}>Connecting to gateway at {gatewayUrl}…</Text>
        )}
      </Box>
    );
  }

  return (
    // Fixed to the terminal height so the message list takes the free space and the input + status bar
    // stay pinned to the bottom ("100%" gave no height at all: Ink's root has no definite size).
    <Box flexDirection="column" width="100%" height={termSize.rows}>
      {state.viewMode === "command-palette" && (
        <Box justifyContent="center" paddingY={1}>
          <CommandPalette
            commands={commands}
            onClose={() => dispatch({ type: "POP_VIEW" })}
          />
        </Box>
      )}

      {state.viewMode === "config" && (
        <Box width="100%" paddingY={1}>
          <ConfigMenu
            client={client}
            providers={state.providers}
            config={state.config}
            agentId={state.activeAgentId ?? state.defaultAgent}
            initialView={configInitialView}
            onClose={() => {
              setConfigInitialView(undefined);
              dispatch({ type: "POP_VIEW" });
            }}
            onConfigChanged={handleConfigChanged}
            onNotice={(text) => dispatch({ type: "ADD_SYSTEM_MESSAGE", text })}
          />
        </Box>
      )}

      {state.viewMode === "sessions" && (
        <SessionList
          sessions={state.sessions}
          onSelect={(sessionKey) => {
            void client
              .call<{ session: { messages: Array<{ role: string; content: string; timestamp?: number }> } | null }>(
                "sessions.get",
                { sessionKey },
              )
              .then(({ session }) => {
                if (!session) return;
                const messages = toChatMessages(session.messages, "loaded");
                const title = state.sessions.find((s) => s.sessionKey === sessionKey)?.title ?? null;
                dispatch({ type: "LOAD_SESSION", sessionKey, messages, title });
                void client
                  .call<{ mode: ApprovalMode }>("tools.approvalMode", { sessionKey })
                  .then(({ mode }) => dispatch({ type: "SET_MODE", mode }))
                  .catch(() => {});
              });
          }}
          onRename={(sessionKey, title) => void renameSession(sessionKey, title)}
          onClose={() => dispatch({ type: "POP_VIEW" })}
        />
      )}

      {state.viewMode === "tools" && <ToolsList tools={state.tools} onClose={() => dispatch({ type: "POP_VIEW" })} />}

      {state.viewMode === "turns" && (
        <TurnsList turns={state.turns} currentSessionKey={state.sessionKey} onClose={() => dispatch({ type: "POP_VIEW" })} />
      )}

      {state.viewMode === "agents" && (
        <Box justifyContent="center" paddingY={1}>
          {showAgentForm ? (
            <AgentForm
              providers={state.providers}
              client={client}
              onCreated={(msg) => {
                setShowAgentForm(false);
                dispatch({ type: "ADD_SYSTEM_MESSAGE", text: msg });
                void client
                  .call<{ agents: AgentInfo[]; defaultAgent: string }>("agents.list")
                  .then(({ agents, defaultAgent }) => dispatch({ type: "SET_AGENTS", agents, defaultAgent }));
              }}
              onBack={() => setShowAgentForm(false)}
            />
          ) : (
            <AgentsList
              agents={state.agents}
              activeAgentId={state.activeAgentId}
              onSelect={(agentId) => {
                dispatch({ type: "SET_ACTIVE_AGENT", agentId });
                dispatch({ type: "POP_VIEW" });
              }}
              onCreate={() => setShowAgentForm(true)}
              onClose={() => dispatch({ type: "POP_VIEW" })}
            />
          )}
        </Box>
      )}

      {(state.viewMode === "chat" || state.viewMode === "command-palette") && (
        <>
          <MessageList
            messages={state.messages}
            streamingText={state.streamingText}
            isStreaming={state.isStreaming}
            isTurnActive={state.isTurnActive}
            toolCalls={state.toolCalls}
            scrollOffset={state.scrollOffset}
            terminalRows={termSize.rows}
            terminalColumns={termSize.columns}
          />

          {state.pendingApproval && (
            <ApprovalPrompt
              approval={state.pendingApproval}
              onRespond={handleApprovalResponse}
            />
          )}

          {slashSuggestions.length > 0 && (
            <SlashAutocomplete
              suggestions={slashSuggestions}
              selectedIndex={slashIndex}
            />
          )}

          <InputBox
            onSubmit={handleSendMessage}
            disabled={readOnly || !!state.pendingApproval || state.isTurnActive}
            placeholder={
              readOnly
                ? "Autonomous run in progress — view only"
                : state.isTurnActive
                  ? "Waiting for response…"
                  : "Type a message… (/ for commands)"
            }
            inputHistory={state.inputHistory}
            historyIndex={state.historyIndex}
            onHistoryChange={(index) => dispatch({ type: "SET_HISTORY_INDEX", index })}
            onInputChange={setCurrentInput}
            slashSuggestions={slashSuggestions}
            slashIndex={slashIndex}
            onSlashIndexChange={setSlashIndex}
          />
        </>
      )}

      <StatusBar state={state} />
    </Box>
  );
}
