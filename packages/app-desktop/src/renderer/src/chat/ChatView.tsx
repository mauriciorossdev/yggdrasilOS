import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";
import { chatReducer, initialChatState } from "./chatReducer.js";
import { useChatEvents } from "./useChatEvents.js";
import { MessageList } from "./MessageList.js";
import { ApprovalBar } from "./ApprovalBar.js";
import { ChatInput } from "./ChatInput.js";
import { SessionSidebar } from "./SessionSidebar.js";
import { ComposerToolbar } from "./ComposerToolbar.js";
import { AgentManager } from "../agents/AgentManager.js";
import { SettingsView } from "../settings/SettingsView.js";
import { FileContentPanel } from "../files/FileContentPanel.js";
import { DocumentsView } from "../documents/DocumentsView.js";
import { MainTabs, type ExtraTab, type MainTab } from "./MainTabs.js";
import { requestTab } from "./mainTabsBridge.js";
import { TerminalContainer } from "../terminal/TerminalContainer.js";
import { AgentFlowView } from "../agentFlow/AgentFlowView.js";
import { WorkflowsView } from "../workflows/WorkflowsView.js";
import { BrowserTabView } from "../browser/BrowserTabView.js";
import { RepositoryView } from "../repository/RepositoryView.js";
import { HomeView } from "../home/HomeView.js";
import { StudioView } from "../studio/StudioView.js";
import { usePlugins } from "../plugins/usePlugins.js";
import { PluginFrame } from "../plugins/PluginFrame.js";
import { PluginToolRuntime } from "../plugins/PluginToolRuntime.js";
import { PluginPanel } from "../plugins/PluginPanel.js";
import type { SidePanel } from "../plugins/pluginTypes.js";
import type {
  AgentInfo,
  ApprovalMode,
  Attachment,
  ChatSendResult,
  FsListResult,
  FsReadDocumentTextResult,
  ProviderInfo,
  SessionInfo,
  SessionRecord,
} from "../types.js";

const CHANNEL_ID = "desktop";
const ACCOUNT_ID = "default";
const MODE_ORDER: ApprovalMode[] = ["auto", "plan", "restrict", "yolo"];

function newSessionKey(): string {
  return `${CHANNEL_ID}:${ACCOUNT_ID}:user-${crypto.randomUUID()}`;
}

export function ChatView() {
  const { call, onEvent } = useGateway();
  const [state, dispatch] = useReducer(chatReducer, undefined, initialChatState);
  const [showAgentManager, setShowAgentManager] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [sidePanel, setSidePanel] = useState<SidePanel | null>(null);
  const [panelWidth, setPanelWidth] = useState(() => window.innerWidth * 0.6);

  // Every time the panel becomes visible it should start at 60vw, not
  // whatever width a previous open session was resized/left at.
  const openFile = useCallback((relativePath: string) => {
    setPanelWidth(window.innerWidth * 0.6);
    setSidePanel({ kind: "file", path: relativePath });
  }, []);
  const openPluginPanel = useCallback((key: string) => {
    setPanelWidth(window.innerWidth * 0.6);
    setSidePanel({ kind: "plugin", key });
  }, []);
  const [activeMainTab, setActiveMainTab] = useState<MainTab>(window.yggdrasil.isDefaultProject ? "home" : "chat");
  const [attachedFiles, setAttachedFiles] = useState<Attachment[]>([]);

  const { plugins, version: pluginsVersion, reload: reloadPlugins } = usePlugins();
  const [openPluginTabs, setOpenPluginTabs] = useState<string[]>([]);
  const pluginsByKey = useMemo(() => new Map(plugins.map((p) => [p.key, p])), [plugins]);

  // A plugin's folder can vanish (deleted, or a broken rescan) out from under
  // an already-open tab — drop it instead of leaving a dead entry that
  // MainTabs would otherwise fall back off of anyway (see its own active-tab
  // effect), so the two stay in sync.
  useEffect(() => {
    setOpenPluginTabs((prev) => prev.filter((key) => pluginsByKey.has(key)));
  }, [pluginsByKey]);

  // Restores which complemento pestañas were open last session — the prune
  // effect above (dep: pluginsByKey) naturally filters this down once the
  // real plugin list has loaded, so a since-deleted plugin's stale key never
  // sticks around.
  useEffect(() => {
    let cancelled = false;
    void window.yggdrasil.plugins.getLayout().then((layout) => {
      if (!cancelled) setOpenPluginTabs(layout.openKeys);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced so rapid open/close churn (or the prune effect settling right
  // after plugins load) doesn't hit disk on every single change.
  useEffect(() => {
    const timer = setTimeout(() => {
      void window.yggdrasil.plugins.saveLayout({ openKeys: openPluginTabs });
    }, 400);
    return () => clearTimeout(timer);
  }, [openPluginTabs]);

  const closePluginTab = useCallback((key: string) => {
    setOpenPluginTabs((prev) => prev.filter((k) => k !== key));
  }, []);

  const openPluginTab = useCallback((key: string) => {
    setOpenPluginTabs((prev) => (prev.includes(key) ? prev : [...prev, key]));
    requestTab(`plugin:${key}` as MainTab);
  }, []);

  /** The sidebar's click handler — opens a complemento in whichever view its manifest prefers (defaultView, else its first declared view). */
  const openPlugin = useCallback(
    (key: string) => {
      const view = pluginsByKey.get(key)?.manifest.defaultView ?? pluginsByKey.get(key)?.manifest.views[0] ?? "tab";
      if (view === "panel") openPluginPanel(key);
      else openPluginTab(key);
    },
    [pluginsByKey, openPluginPanel, openPluginTab],
  );

  // open_plugin (an agent, via the plugins MCP tool) wants this window to
  // show a complemento — see paneControlServer.ts's POST /plugins/:scope/:id/open.
  useEffect(
    () =>
      window.yggdrasil.plugins.onOpenRequest(({ key, view }) => {
        if (view === "panel") openPluginPanel(key);
        else if (view === "tab") openPluginTab(key);
        else openPlugin(key);
      }),
    [openPlugin, openPluginPanel, openPluginTab],
  );

  useChatEvents(onEvent, dispatch, state.sessionKey);

  const refreshSessions = useCallback(async () => {
    const res = await call<{ sessions: SessionInfo[] }>("sessions.list");
    dispatch({ type: "SET_SESSIONS", sessions: res.sessions ?? [] });
  }, [call]);

  useEffect(() => {
    (async () => {
      try {
        const [agentsRes, providersRes] = await Promise.all([
          call<{ agents: AgentInfo[]; defaultAgent: string }>("agents.list"),
          call<{ providers: ProviderInfo[] }>("providers.list"),
          refreshSessions(),
        ]);
        dispatch({ type: "SET_AGENTS", agents: agentsRes.agents, defaultAgent: agentsRes.defaultAgent });
        dispatch({ type: "SET_PROVIDERS", providers: providersRes.providers ?? [] });
        const sessionKey = newSessionKey();
        dispatch({ type: "SET_SESSION_KEY", sessionKey });
        try {
          const { mode } = await call<{ mode: ApprovalMode }>("tools.approvalMode", { sessionKey });
          dispatch({ type: "SET_MODE", mode });
        } catch {
          // non-fatal — keep the local "auto" default
        }
      } catch (err) {
        dispatch({
          type: "ADD_SYSTEM_MESSAGE",
          text: `Failed to load: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    })();
  }, [call, refreshSessions]);

  const attachFile = useCallback((a: Attachment) => {
    setAttachedFiles((prev) => (prev.some((x) => x.relativePath === a.relativePath) ? prev : [...prev, a]));
  }, []);

  const removeAttachment = useCallback((relativePath: string) => {
    setAttachedFiles((prev) => prev.filter((a) => a.relativePath !== relativePath));
  }, []);

  const resolveAttachments = useCallback(
    async (files: Attachment[]): Promise<string> => {
      const blocks = await Promise.all(
        files.map(async (a) => {
          try {
            if (a.type === "file") {
              // fs.readDocumentText (not fs.read) — extracts real text out
              // of formats fs.read's plain-utf8 decode would corrupt (a
              // PDF's bytes aren't valid utf8), so attaching e.g. a note
              // from notes/ that happens to be a PDF sends usable context
              // instead of garbage.
              const res = await call<FsReadDocumentTextResult>("fs.readDocumentText", {
                relativePath: a.relativePath,
              });
              const suffix = res.truncated ? "\n[...truncated]" : "";
              return `--- ${a.relativePath} ---\n${res.content}${suffix}`;
            }
            const res = await call<FsListResult>("fs.list", { relativePath: a.relativePath });
            const listing = res.entries.map((e) => `- ${e.name}${e.type === "directory" ? "/" : ""}`).join("\n");
            return `--- ${a.relativePath}/ (folder) ---\n${listing || "(empty)"}`;
          } catch (err) {
            return `--- ${a.relativePath} --- (failed to read: ${err instanceof Error ? err.message : String(err)})`;
          }
        }),
      );
      return blocks.join("\n\n");
    },
    [call],
  );

  const send = useCallback(
    async (text: string) => {
      if (!state.sessionKey) return;
      dispatch({ type: "ADD_USER_MESSAGE", text });

      let outgoing = text;
      const pendingAttachments = attachedFiles;
      if (pendingAttachments.length > 0) {
        const attachmentText = await resolveAttachments(pendingAttachments);
        outgoing = `${text}\n\nAttached:\n${attachmentText}`;
        setAttachedFiles([]);
      }

      try {
        await call<ChatSendResult>(
          "chat.send",
          {
            message: outgoing,
            sessionKey: state.sessionKey,
            agentId: state.activeAgentId ?? undefined,
            provider: state.modelOverride?.provider,
            model: state.modelOverride?.model,
            channelId: CHANNEL_ID,
            accountId: ACCOUNT_ID,
            senderId: "user",
          },
          // Generous timeout for the RPC ack itself — local models (Ollama)
          // can legitimately take a while, especially on a cold load. This
          // only bounds how long we wait for the request/response round
          // trip; the actual reply always arrives via the persistent
          // chat.delta/chat.final event subscription regardless of whether
          // this call resolves, times out, or the window is later reopened.
          { timeoutMs: 180_000 },
        );
        await refreshSessions();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // A timed-out ack isn't a failed turn — the gateway is still working
        // and chat.final will still land via the event listener. Don't
        // alarm the user with an "Error:" message for something that's
        // actually still in flight.
        if (message.startsWith("Timeout:")) {
          await refreshSessions();
        } else {
          dispatch({ type: "ADD_SYSTEM_MESSAGE", text: `Error: ${message}` });
        }
      }
    },
    [call, state.sessionKey, state.activeAgentId, state.modelOverride, refreshSessions, attachedFiles, resolveAttachments],
  );

  const setMode = useCallback(
    (next: ApprovalMode) => {
      if (!state.sessionKey) return;
      dispatch({ type: "SET_MODE", mode: next });
      void call("tools.setApprovalMode", { sessionKey: state.sessionKey, mode: next }).catch((err) => {
        dispatch({
          type: "ADD_SYSTEM_MESSAGE",
          text: `Failed to change mode: ${err instanceof Error ? err.message : String(err)}`,
        });
      });
    },
    [call, state.sessionKey],
  );

  const cycleMode = useCallback(() => {
    const next = MODE_ORDER[(MODE_ORDER.indexOf(state.mode) + 1) % MODE_ORDER.length]!;
    setMode(next);
  }, [state.mode, setMode]);

  const respondApproval = useCallback(
    (requestId: string, approved: boolean, trustDeviceId?: string) => {
      void call("tools.approve", { requestId, approved });
      // Fired alongside, not instead of, the approve/deny above — trusting
      // a device only ever accompanies an explicit Approve click (see
      // ApprovalBar's checkbox), never replaces answering this specific
      // request.
      if (trustDeviceId) void call("devices.trust.set", { deviceId: trustDeviceId, trusted: true });
    },
    [call],
  );

  const selectSession = useCallback(
    async (sessionKey: string) => {
      const res = await call<{ session: SessionRecord | null }>("sessions.get", { sessionKey });
      if (!res.session) return;
      dispatch({
        type: "LOAD_SESSION",
        sessionKey,
        messages: res.session.messages.map((m, i) => ({
          id: `resumed-${i}`,
          role: (m.role === "user" || m.role === "assistant" || m.role === "tool" ? m.role : "system") as
            | "user"
            | "assistant"
            | "tool"
            | "system",
          text: m.content,
          timestamp: m.timestamp ?? Date.now(),
        })),
      });
      try {
        const { mode } = await call<{ mode: ApprovalMode }>("tools.approvalMode", { sessionKey });
        dispatch({ type: "SET_MODE", mode });
      } catch {
        // non-fatal — keep whatever mode was already shown
      }
    },
    [call],
  );

  const newChat = useCallback(() => {
    dispatch({ type: "LOAD_SESSION", sessionKey: newSessionKey(), messages: [] });
    dispatch({ type: "SET_MODE", mode: "auto" });
  }, []);

  const renameSession = useCallback(
    async (sessionKey: string, title: string) => {
      try {
        await call("sessions.patch", { sessionKey, title });
        await refreshSessions();
      } catch (err) {
        dispatch({
          type: "ADD_SYSTEM_MESSAGE",
          text: `Rename failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    },
    [call, refreshSessions],
  );

  const deleteSession = useCallback(
    async (sessionKey: string) => {
      try {
        await call("sessions.reset", { sessionKey });
        await refreshSessions();
        if (sessionKey === state.sessionKey) newChat();
      } catch (err) {
        dispatch({
          type: "ADD_SYSTEM_MESSAGE",
          text: `Delete failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    },
    [call, refreshSessions, state.sessionKey, newChat],
  );

  const handleAgentsCreated = useCallback(
    (agents: AgentInfo[], newAgentId: string) => {
      dispatch({ type: "SET_AGENTS", agents, defaultAgent: state.defaultAgent ?? newAgentId });
      dispatch({ type: "SET_ACTIVE_AGENT", agentId: newAgentId });
      setShowAgentManager(false);
    },
    [state.defaultAgent],
  );

  const handleAgentDeleted = useCallback(
    (agents: AgentInfo[], deletedId: string) => {
      const fallbackId = agents[0]?.id ?? "";
      const nextDefault = state.defaultAgent && state.defaultAgent !== deletedId ? state.defaultAgent : fallbackId;
      dispatch({ type: "SET_AGENTS", agents, defaultAgent: nextDefault });
      if (state.activeAgentId === deletedId) {
        dispatch({ type: "SET_ACTIVE_AGENT", agentId: fallbackId });
      }
    },
    [state.defaultAgent, state.activeAgentId],
  );

  const runningTools = [...state.toolCalls.values()]
    .filter((t) => t.status === "running")
    .map((t) => t.toolName);

  const extraTabs: ExtraTab[] = useMemo(
    () =>
      openPluginTabs.flatMap((key) => {
        const plugin = pluginsByKey.get(key);
        if (!plugin) return [];
        const tabId = `plugin:${key}` as MainTab;
        return [
          {
            id: tabId,
            label: plugin.manifest.name,
            icon:
              plugin.manifest.icon && !plugin.manifest.icon.includes(".") ? (
                <span className="main-tab-plugin-icon">{plugin.manifest.icon}</span>
              ) : undefined,
            content: (
              <PluginFrame
                plugin={plugin}
                version={pluginsVersion}
                visible={activeMainTab === tabId}
                onOpenFile={openFile}
                onOpenTab={(tab) => requestTab(tab as MainTab)}
              />
            ),
            onClose: () => closePluginTab(key),
          },
        ];
      }),
    [openPluginTabs, pluginsByKey, pluginsVersion, activeMainTab, openFile, closePluginTab],
  );

  /** One aside slot, two possible contents — same outer shell/CSS classes either way (FileContentPanel and PluginPanel both render `<aside className="file-content-panel ...">`), so the two resizer/positioning blocks below stay identical regardless of which is open. */
  const renderSidePanel = (extraClassName?: string) => {
    if (!sidePanel) return null;
    if (sidePanel.kind === "file") {
      return (
        <FileContentPanel
          relativePath={sidePanel.path}
          onClose={() => setSidePanel(null)}
          className={extraClassName}
          style={{ width: panelWidth }}
        />
      );
    }
    const plugin = pluginsByKey.get(sidePanel.key);
    if (!plugin) return null;
    return (
      <PluginPanel
        plugin={plugin}
        version={pluginsVersion}
        onClose={() => setSidePanel(null)}
        onOpenFile={openFile}
        onOpenTab={(tab) => requestTab(tab as MainTab)}
        className={extraClassName}
        style={{ width: panelWidth }}
      />
    );
  };

  return (
    <div className="chat-shell">
      <SessionSidebar
        sessions={state.sessions}
        activeSessionKey={state.sessionKey}
        onSelectSession={(k) => void selectSession(k)}
        onNewChat={newChat}
        onManageAgents={() => setShowAgentManager(true)}
        onOpenSettings={() => setShowSettings(true)}
        onRenameSession={(k, title) => void renameSession(k, title)}
        onDeleteSession={(k) => void deleteSession(k)}
        agents={state.agents}
        activeAgentId={state.activeAgentId}
        onSelectAgent={(agentId) => dispatch({ type: "SET_ACTIVE_AGENT", agentId })}
        onOpenFile={openFile}
        plugins={plugins}
        onOpenPlugin={openPlugin}
        onOpenPluginTab={openPluginTab}
        onOpenPluginPanel={openPluginPanel}
        onReloadPlugins={() => void reloadPlugins()}
      />
      <PluginToolRuntime plugins={plugins} />
      <div className="chat-main">
        <MainTabs
          homeContent={window.yggdrasil.isDefaultProject ? <HomeView /> : undefined}
          chatContent={
            <>
              <MessageList
                messages={state.messages}
                streamingText={state.streamingText}
                isStreaming={state.isStreaming}
                isTurnActive={state.isTurnActive}
                runningTools={runningTools}
              />
              {state.pendingApproval && (
                <ApprovalBar key={state.pendingApproval.requestId} approval={state.pendingApproval} onRespond={respondApproval} />
              )}
              <ChatInput
                disabled={!state.sessionKey || !!state.pendingApproval}
                isStreaming={state.isStreaming}
                onSend={(t) => void send(t)}
                onStop={() => void call("chat.stop", { sessionKey: state.sessionKey })}
                attachments={attachedFiles}
                onAttach={attachFile}
                onRemoveAttachment={removeAttachment}
                onCycleMode={cycleMode}
              />
              <ComposerToolbar
                agents={state.agents}
                activeAgentId={state.activeAgentId}
                onSelectAgent={(agentId) => dispatch({ type: "SET_ACTIVE_AGENT", agentId })}
                providers={state.providers}
                modelOverride={state.modelOverride}
                onSelectModel={(override) => dispatch({ type: "SET_MODEL_OVERRIDE", override })}
                mode={state.mode}
                onSelectMode={setMode}
              />
            </>
          }
          terminalContent={<TerminalContainer />}
          agentFlowContent={<AgentFlowView />}
          workflowsContent={<WorkflowsView />}
          documentsContent={<DocumentsView />}
          browserContent={<BrowserTabView />}
          studioContent={<StudioView />}
          repositoryContent={<RepositoryView />}
          extraTabs={extraTabs}
          onActiveTabChange={setActiveMainTab}
        />
        {/* fs.write/fs.delete/etc. always require approval, even from this
            app's own loopback connection (deliberate — see methods.ts) — but
            ApprovalBar above only renders inside the Chat tab's own hidden
            panel, so a Documents/Terminal/Agent-Flow-triggered approval
            (e.g. saving a file in FileContentPanel) had nowhere visible to
            be answered and just timed out. Same pendingApproval/respondApproval,
            just surfaced as a floating banner when Chat isn't the active tab. */}
        {state.pendingApproval && activeMainTab !== "chat" && (
          <div className="approval-bar-overlay">
            <ApprovalBar key={state.pendingApproval.requestId} approval={state.pendingApproval} onRespond={respondApproval} />
          </div>
        )}
        {/* Terminal tab: a floating drawer over the panes instead of a side
            column — shrinking .chat-main here would resize/reflow the real
            xterm panes underneath, which the column mode doesn't have to
            worry about for chat/agentFlow/documents. Same panelWidth state
            and drag math as the column's resizer below — just positioned
            absolutely at the drawer's left seam instead of sitting in flow. */}
        {sidePanel && activeMainTab === "terminal" && (
          <>
            <div
              className="file-content-resizer file-content-resizer-drawer"
              style={{ right: panelWidth }}
              onPointerDown={(e) => {
                const startX = e.clientX;
                const startWidth = panelWidth;
                const onMouseMove = (e: MouseEvent) => {
                  setPanelWidth(Math.max(200, startWidth - (e.clientX - startX)));
                };
                const onMouseUp = () => {
                  window.removeEventListener("mousemove", onMouseMove);
                  window.removeEventListener("mouseup", onMouseUp);
                };
                window.addEventListener("mousemove", onMouseMove);
                window.addEventListener("mouseup", onMouseUp);
              }}
            />
            {renderSidePanel("file-content-panel-drawer")}
          </>
        )}
      </div>
      {sidePanel && activeMainTab !== "terminal" && (
        <div
          className="file-content-resizer"
          style={{ right: panelWidth }}
          onPointerDown={(e) => {
            const startX = e.clientX;
            const startWidth = panelWidth;
            const onMouseMove = (e: MouseEvent) => {
              setPanelWidth(Math.max(200, startWidth - (e.clientX - startX)));
            };
            const onMouseUp = () => {
              window.removeEventListener("mousemove", onMouseMove);
              window.removeEventListener("mouseup", onMouseUp);
            };
            window.addEventListener("mousemove", onMouseMove);
            window.addEventListener("mouseup", onMouseUp);
          }}
        />
      )}
      {sidePanel && activeMainTab !== "terminal" && renderSidePanel()}
      {showAgentManager && (
        <AgentManager
          agents={state.agents}
          onClose={() => setShowAgentManager(false)}
          onCreated={handleAgentsCreated}
          onDeleted={handleAgentDeleted}
        />
      )}
      {showSettings && <SettingsView onClose={() => setShowSettings(false)} />}
    </div>
  );
}
