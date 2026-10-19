import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Box, Text, useApp } from "ink";
import { buildSessionKey } from "@yggdrasil/config";
import { theme } from "../render/theme.js";
import { GatewayClient } from "../client/gateway-client.js";
import type { AgentInfo, ApprovalMode, ConfigGetResult, ProviderInfo, SessionInfo } from "../client/types.js";
import { initialState, tuiReducer } from "../state/store.js";
import { useGatewayEvents } from "../hooks/useGatewayEvents.js";
import { useKeybinds } from "../hooks/useKeybinds.js";
import { MessageList } from "./MessageList.js";
import { InputBox } from "./InputBox.js";
import { StatusBar } from "./StatusBar.js";
import { ApprovalPrompt } from "./ApprovalPrompt.js";
import { CommandPalette, type Command } from "./CommandPalette.js";
import { ConfigMenu } from "./config/ConfigMenu.js";
import { SessionList } from "./SessionList.js";
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
};

export function App({
  gatewayUrl,
  senderIdPrefix,
  continueSession,
  initialAgentId,
  initialSessionKey,
  readOnly,
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
    clientRef.current = new GatewayClient(gatewayUrl);
  }
  const client = clientRef.current;

  const termSize = useTerminalSize();
  setMarkdownWidth(termSize.columns - 4);

  useGatewayEvents(client, dispatch, state.sessionKey);

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

  useKeybinds(dispatch, state.viewMode, () => {
    client.disconnect();
    exit();
  }, handleCycleMode);

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
            resumedMessages = session.messages.map((m, i) => ({
              id: `resumed-${i}`,
              role: (m.role === "user" || m.role === "assistant" || m.role === "tool" ? m.role : "system") as ChatMessage["role"],
              text: m.content,
              timestamp: m.timestamp ?? Date.now(),
            }));
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
              resumedMessages = session.messages.map((m, i) => ({
                id: `resumed-${i}`,
                role: (m.role === "user" || m.role === "assistant" || m.role === "tool" ? m.role : "system") as ChatMessage["role"],
                text: m.content,
                timestamp: m.timestamp ?? Date.now(),
              }));
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
          const { mode } = await client.call<{ mode: ApprovalMode }>("tools.approvalMode", { sessionKey });
          dispatch({ type: "SET_MODE", mode });
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
        if (!disposed && skillCmdsResult.commands.length > 0) {
          setSkillCommands(skillCmdsResult.commands);
        }
      } catch (err) {
        if (!disposed) {
          const msg = err instanceof Error ? err.message : String(err);
          dispatch({ type: "SET_CONNECTION_ERROR", error: msg });
        }
      }
    }

    void init();

    return () => {
      disposed = true;
      client.disconnect();
    };
  }, [client]);

  const handleSendMessage = useCallback(
    async (text: string) => {
      if (text.startsWith("/")) {
        handleSlashCommand(text);
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
          },
          // Local/slow models can take minutes per turn — the RPC ack just
          // confirms the gateway accepted the message; the actual reply
          // arrives later via turn.start/turn.end + chat events regardless
          // of this promise, so give it plenty of room before giving up.
          10 * 60_000,
        );
      } catch (err) {
        dispatch({
          type: "ADD_SYSTEM_MESSAGE",
          text: `Failed to send message: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    },
    [client, state.sessionKey, state.activeAgentId],
  );

  const handleSlashCommand = useCallback(
    (text: string) => {
      const parts = text.slice(1).split(/\s+/);
      const cmd = parts[0]?.toLowerCase();

      switch (cmd) {
        case "reset":
          void client.call("sessions.reset", { sessionKey: state.sessionKey }).then(() => {
            dispatch({ type: "RESET_MESSAGES" });
          });
          break;
        case "agent": {
          const agentId = parts[1];
          if (agentId) {
            dispatch({ type: "SET_ACTIVE_AGENT", agentId });
          }
          break;
        }
        case "sessions":
          void client
            .call<{ sessions: SessionInfo[] }>("sessions.list")
            .then(({ sessions }) => {
              dispatch({ type: "SET_SESSIONS", sessions });
              dispatch({ type: "PUSH_VIEW", mode: "sessions" });
            });
          break;
        case "config":
          dispatch({ type: "PUSH_VIEW", mode: "config" });
          break;
        case "agents":
          void client
            .call<{ agents: AgentInfo[]; defaultAgent: string }>("agents.list")
            .then(({ agents, defaultAgent }) => {
              dispatch({ type: "SET_AGENTS", agents, defaultAgent });
              setShowAgentForm(false);
              dispatch({ type: "PUSH_VIEW", mode: "agents" });
            });
          break;
        case "model": {
          const agent = state.agents.find(
            (a) => a.id === (state.activeAgentId ?? state.defaultAgent),
          );
          if (agent?.provider) {
            setConfigInitialView({ view: "model", providerId: agent.provider });
          }
          dispatch({ type: "PUSH_VIEW", mode: "config" });
          break;
        }
        case "compact": {
          if (!state.sessionKey) break;
          void client
            .call<{ compacted: boolean; before: number; after: number }>("sessions.compact", {
              sessionKey: state.sessionKey,
              agentId: state.activeAgentId,
            })
            .then(({ compacted, before, after }) => {
              dispatch({
                type: "ADD_SYSTEM_MESSAGE",
                text: compacted
                  ? `✓ Compacted: ${before} → ${after} messages`
                  : "Nothing to compact",
              });
            })
            .catch((err) => {
              dispatch({
                type: "ADD_SYSTEM_MESSAGE",
                text: `✗ Compact failed: ${err instanceof Error ? err.message : String(err)}`,
              });
            });
          break;
        }
        case "export": {
          if (!state.sessionKey) break;
          const sessionKey = state.sessionKey;
          void client
            .call<{
              session: { messages: Array<{ role: string; content: string; timestamp?: number }> } | null;
            }>("sessions.get", { sessionKey })
            .then(async ({ session }) => {
              if (!session) {
                dispatch({ type: "ADD_SYSTEM_MESSAGE", text: "✗ No session to export" });
                return;
              }
              const lines = session.messages.map(
                (m) => `## ${m.role}\n\n${m.content}\n`,
              );
              const filename = `yggdrasil-session-${sessionKey.slice(-8)}-${Date.now()}.md`;
              const path = join(process.cwd(), filename);
              await writeFile(path, lines.join("\n"), "utf8");
              dispatch({ type: "ADD_SYSTEM_MESSAGE", text: `✓ Exported to ${path}` });
            })
            .catch((err) => {
              dispatch({
                type: "ADD_SYSTEM_MESSAGE",
                text: `✗ Export failed: ${err instanceof Error ? err.message : String(err)}`,
              });
            });
          break;
        }
        case "new": {
          const prefix = senderIdPrefix ?? "local";
          const newKey = buildSessionKey("tui", "default", `${prefix}-${randomUUID()}`);
          dispatch({ type: "SET_SESSION_KEY", sessionKey: newKey });
          dispatch({ type: "RESET_MESSAGES" });
          dispatch({ type: "SET_MODE", mode: "auto" });
          break;
        }
        case "status": {
          const agent = state.agents.find(
            (a) => a.id === (state.activeAgentId ?? state.defaultAgent),
          );
          dispatch({
            type: "ADD_SYSTEM_MESSAGE",
            text: [
              `gateway: ${gatewayUrl}`,
              `session: ${state.sessionKey ?? "none"}`,
              `agent: ${agent?.id ?? "none"} (${agent?.provider ?? "?"}/${agent?.model ?? "?"})`,
              `connected: ${state.connected ? "yes" : "no"}`,
            ].join("\n"),
          });
          break;
        }
        case "help":
          dispatch({
            type: "ADD_SYSTEM_MESSAGE",
            text: [
              "/reset — Clear session history",
              "/config — Open configuration menu",
              "/sessions — List all sessions",
              "/agents — Manage agents (view, switch, create)",
              "/agent <id> — Switch active agent",
              "/model — Jump to model selector",
              "/compact — Force session compaction now",
              "/export — Export session transcript to markdown",
              "/new — Start a new isolated session",
              "/status — Show connection/session/agent status",
              "/help — Show this list",
              "/exit — Quit TUI",
            ].join("\n"),
          });
          break;
        case "exit":
        case "quit":
          client.disconnect();
          exit();
          break;
        default:
          break;
      }
    },
    [client, state.sessionKey, state.agents, state.activeAgentId, state.defaultAgent, state.connected, gatewayUrl, senderIdPrefix, exit],
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

  const commands: Command[] = useMemo(
    () => [
      {
        name: "reset",
        description: "Clear session history",
        action: () => handleSlashCommand("/reset"),
      },
      {
        name: "config",
        description: "Open configuration menu",
        shortcut: "/config",
        action: () => dispatch({ type: "PUSH_VIEW", mode: "config" }),
      },
      {
        name: "sessions",
        description: "List all sessions",
        action: () => handleSlashCommand("/sessions"),
      },
      {
        name: "agents",
        description: "Manage agents (view, switch, create)",
        action: () => handleSlashCommand("/agents"),
      },
      {
        name: "new",
        description: "Start a new isolated session",
        action: () => handleSlashCommand("/new"),
      },
      {
        name: "status",
        description: "Show connection/session/agent status",
        action: () => handleSlashCommand("/status"),
      },
      {
        name: "help",
        description: "List all commands",
        action: () => handleSlashCommand("/help"),
      },
      {
        name: "export",
        description: "Export session transcript to markdown",
        action: () => handleSlashCommand("/export"),
      },
      {
        name: "compact",
        description: "Force session compaction now",
        action: () => handleSlashCommand("/compact"),
      },
      {
        name: "model",
        description: "Jump to model selector",
        action: () => handleSlashCommand("/model"),
      },
      ...state.agents.map((a) => ({
        name: `agent ${a.id}`,
        description: `Switch to ${a.id} (${a.provider}/${a.model})`,
        action: () => dispatch({ type: "SET_ACTIVE_AGENT", agentId: a.id }),
      })),
      ...skillCommands.map((cmd) => ({
        name: cmd.name,
        description: cmd.description,
        action: () => handleSendMessage(cmd.prompt.replace(/\{\{args\}\}/g, "")),
      })),
      {
        name: "exit",
        description: "Quit TUI",
        action: () => {
          client.disconnect();
          exit();
        },
      },
    ],
    [state.agents, skillCommands, handleSlashCommand, handleSendMessage, client, exit],
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
    <Box flexDirection="column" width="100%" height="100%">
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
                const messages: ChatMessage[] = session.messages.map((m, i) => ({
                  id: `loaded-${i}`,
                  role: (m.role === "user" || m.role === "assistant" || m.role === "tool" ? m.role : "system") as ChatMessage["role"],
                  text: m.content,
                  timestamp: m.timestamp ?? Date.now(),
                }));
                dispatch({ type: "LOAD_SESSION", sessionKey, messages });
                void client
                  .call<{ mode: ApprovalMode }>("tools.approvalMode", { sessionKey })
                  .then(({ mode }) => dispatch({ type: "SET_MODE", mode }))
                  .catch(() => {});
              });
          }}
          onClose={() => dispatch({ type: "POP_VIEW" })}
        />
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
