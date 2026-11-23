import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";
import { chatReducer, initialChatState } from "@yggdrasil/ui-kit";
import { t as tStatic, useI18n } from "../i18n/index.js";
import { useChatEvents } from "@yggdrasil/ui-kit";
import { MessageList } from "@yggdrasil/ui-kit";
import { ApprovalBar } from "@yggdrasil/ui-kit";
import { ChatInput } from "./ChatInput.js";
import { SessionSidebar } from "./SessionSidebar.js";
import { ComposerToolbar } from "./ComposerToolbar.js";
import { onAgentsChanged } from "@yggdrasil/ui-kit";
import { SettingsView, type SettingsSection } from "../settings/SettingsView.js";
import { FileContentPanel } from "../files/FileContentPanel.js";
import { DiffContentPanel } from "../files/DiffContentPanel.js";
import type { DiffTarget } from "../files/RemoteFilesPanel.js";
import { registerFallbackFileOpener } from "../files/openFileBus.js";
import { DocumentsView } from "../documents/DocumentsView.js";
import { FilesView } from "../files/FilesView.js";
import { MainTabs, type ExtraTab, type MainTab } from "./MainTabs.js";
import { requestTab } from "./mainTabsBridge.js";
import { ChatSplit } from "../workspace/ChatSplit.js";
import { openWorkspaceTab, workspaceKindFor } from "../workspace/workspaceStore.js";
import { handleEditorRequest } from "../workspace/editorBridge.js";
import { onChatAttach } from "./chatAttachBridge.js";
import { TerminalContainer } from "../terminal/TerminalContainer.js";
import { PaneBranchProvider } from "../terminal/paneBranchContext.js";
import { AgentFlowView } from "../agentFlow/AgentFlowView.js";
import { WorkflowsView } from "../workflows/WorkflowsView.js";
import { WorktreesView } from "../worktrees/WorktreesView.js";
import { BrowserTabView } from "../browser/BrowserTabView.js";
import { RepositoryView } from "../repository/RepositoryView.js";
import { HomeView } from "../home/HomeView.js";
import { WorkspacesCanvas } from "../home/WorkspacesCanvas.js";
import { StudioView } from "../studio/StudioView.js";
import { usePlugins } from "../plugins/usePlugins.js";
import { PluginFrame } from "../plugins/PluginFrame.js";
import { PluginToolRuntime } from "../plugins/PluginToolRuntime.js";
import { PluginPanel } from "../plugins/PluginPanel.js";
import { sidePanelKey, type SidePanel } from "../plugins/pluginTypes.js";
import { PanelTabs, type PanelTabInfo } from "./PanelTabs.js";
import { TerminalSidePanel } from "./TerminalSidePanel.js";
import { requestFocusPane, useTerminalPanes } from "../terminal/terminalPanesStore.js";
import {
  clampPanelWidth,
  createSidePanelReducer,
  defaultPanelWidth,
  initialSidePanelState,
  readPanelPinned,
  SIDE_PANEL_MOTION_MS,
  writePanelPinned,
} from "./sidePanelMotion.js";

const sidePanelReducer = createSidePanelReducer<SidePanel>(sidePanelKey);
import { setBrowserTabCovered, setBrowserTabOcclusion } from "../browser/browserTabBridge.js";
import { PanelPinButton } from "../files/PanelPinButton.js";
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

/** Width of .file-content-resizer in styles.css. */
const PANEL_RESIZER_WIDTH = 4;

export function ChatView() {
  const { call, onEvent } = useGateway();
  const { t } = useI18n();
  const [state, dispatch] = useReducer(chatReducer, undefined, initialChatState);
  // Which Settings section is open (null = closed); the composer's "Manage agents…" opens it at Agents.
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null);
  const [{ tabs: panelTabs, activeKey: activePanelKey, phase: panelPhase }, dispatchPanel] = useReducer(
    sidePanelReducer,
    undefined,
    initialSidePanelState<SidePanel>,
  );
  // The tab that is showing; everything below that asked "is a panel open / what is it" reads this.
  const sidePanel = panelTabs.find((p) => sidePanelKey(p) === activePanelKey) ?? panelTabs[0] ?? null;
  const { panes: terminalPanes } = useTerminalPanes();
  const [panelWidth, setPanelWidth] = useState(() => defaultPanelWidth(window.innerWidth));

  // Every time the panel becomes visible it should start at 60vw, not
  // whatever width a previous open session was resized/left at.
  const panelVisibleRef = useRef(false);
  panelVisibleRef.current = panelTabs.length > 0 && panelPhase !== "exit";
  const openInPanel = useCallback((panel: SidePanel) => {
    if (!panelVisibleRef.current) setPanelWidth(defaultPanelWidth(window.innerWidth));
    dispatchPanel({ type: "open", panel });
  }, []);
  const openFile = useCallback(
    (relativePath: string) => {
      // Office files have their own editors in the container beside the chat, not the file side panel.
      const kind = workspaceKindFor(relativePath);
      if (kind) {
        openWorkspaceTab(kind, relativePath);
        requestTab("chat");
        return;
      }
      openInPanel({ kind: "file", path: relativePath });
    },
    [openInPanel],
  );
  useEffect(() => registerFallbackFileOpener(openFile), [openFile]);
  // An agent's office tool call (gateway → main → here): run it on the open editor and answer.
  useEffect(
    () =>
      window.yggdrasil.editors.onRequest((req) => {
        handleEditorRequest(req).then(
          (result) => void window.yggdrasil.editors.reply(req.callId, true, result),
          (err) => void window.yggdrasil.editors.reply(req.callId, false, err instanceof Error ? err.message : String(err)),
        );
      }),
    [],
  );
  const openDiff = useCallback((target: DiffTarget) => openInPanel({ kind: "diff", ...target }), [openInPanel]);
  const openPluginPanel = useCallback((key: string) => openInPanel({ kind: "plugin", key }), [openInPanel]);
  const openTerminalPanel = useCallback((id: string) => openInPanel({ kind: "terminal", id }), [openInPanel]);
  useEffect(() => {
    if (panelPhase === "open") return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = setTimeout(() => dispatchPanel({ type: "settled" }), reduced ? 0 : SIDE_PANEL_MOTION_MS);
    return () => clearTimeout(timer);
  }, [panelPhase]);
  const [panelPinned, setPanelPinned] = useState(readPanelPinned);
  const togglePanelPinned = useCallback(() => {
    setPanelPinned((pinned) => {
      writePanelPinned(!pinned);
      return !pinned;
    });
  }, []);
  // The Browser tab's page is a native layer that paints over any DOM, whatever its
  // z-index, so floating over it means cutting the page off where the panel starts.
  const panelFloating = !!sidePanel && !panelPinned;
  useEffect(() => {
    setBrowserTabOcclusion(panelFloating ? panelWidth + PANEL_RESIZER_WIDTH : 0);
  }, [panelFloating, panelWidth]);
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
          text: tStatic("chat.view.failedLoad", { message: err instanceof Error ? err.message : String(err) }),
        });
      }
    })();
  }, [call, refreshSessions]);

  const attachFile = useCallback((a: Attachment) => {
    setAttachedFiles((prev) => (prev.some((x) => x.relativePath === a.relativePath) ? prev : [...prev, a]));
  }, []);

  // "Send to chat" from the file tree's context menu.
  useEffect(() => onChatAttach(attachFile), [attachFile]);

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
          dispatch({ type: "ADD_SYSTEM_MESSAGE", text: t("chat.view.error", { message }) });
        }
      }
    },
    [call, t, state.sessionKey, state.activeAgentId, state.modelOverride, refreshSessions, attachedFiles, resolveAttachments],
  );

  const setMode = useCallback(
    (next: ApprovalMode) => {
      if (!state.sessionKey) return;
      dispatch({ type: "SET_MODE", mode: next });
      void call("tools.setApprovalMode", { sessionKey: state.sessionKey, mode: next }).catch((err) => {
        dispatch({
          type: "ADD_SYSTEM_MESSAGE",
          text: t("chat.view.failedMode", { message: err instanceof Error ? err.message : String(err) }),
        });
      });
    },
    [call, t, state.sessionKey],
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
          text: t("chat.view.renameFailed", { message: err instanceof Error ? err.message : String(err) }),
        });
      }
    },
    [call, t, refreshSessions],
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
          text: t("chat.view.deleteFailed", { message: err instanceof Error ? err.message : String(err) }),
        });
      }
    },
    [call, t, refreshSessions, state.sessionKey, newChat],
  );

  const handleAgentsCreated = useCallback(
    (agents: AgentInfo[], newAgentId: string) => {
      dispatch({ type: "SET_AGENTS", agents, defaultAgent: state.defaultAgent ?? newAgentId });
      dispatch({ type: "SET_ACTIVE_AGENT", agentId: newAgentId });
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

  // Agents are edited in Settings → Agents, which may have been opened from elsewhere (title bar, Home).
  useEffect(
    () =>
      onAgentsChanged((change) =>
        change.kind === "saved"
          ? handleAgentsCreated(change.agents, change.agentId)
          : handleAgentDeleted(change.agents, change.agentId),
      ),
    [handleAgentsCreated, handleAgentDeleted],
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

  // Preventing the default stops the drag from selecting the text it crosses, and the
  // capture keeps it alive over the editor, terminals and plugin iframes under the pointer.
  const startPanelResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    // Pointer capture doesn't reach across the Browser tab's native page, so it's swapped for a still image meanwhile.
    const overBrowser = activeMainTab === "browser";
    if (overBrowser) setBrowserTabCovered(true);
    const startX = e.clientX;
    const startWidth = panelWidth;
    const move = (m: PointerEvent) => setPanelWidth(clampPanelWidth(startWidth - (m.clientX - startX), window.innerWidth));
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      if (overBrowser) setBrowserTabCovered(false);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  const panelTabInfos: PanelTabInfo[] = panelTabs.map((p) => {
    const key = sidePanelKey(p);
    switch (p.kind) {
      case "file":
        return { key, label: p.path.split("/").pop() ?? p.path, title: p.path };
      case "diff":
        return { key, label: `± ${p.path.split("/").pop() ?? p.path}`, title: p.path };
      case "plugin":
        return { key, label: pluginsByKey.get(p.key)?.manifest.name ?? p.key };
      case "terminal":
        return { key, label: terminalPanes.find((x) => x.id === p.id)?.title ?? "Terminal" };
    }
  });

  /**
   * The aside: one shell per open tab, all mounted (the inactive ones just hidden) so switching tabs
   * never drops an unsaved edit or a running plugin's state. Every panel renders the same
   * `<aside className="file-content-panel ...">` with the tab strip on top, so the two
   * resizer/positioning blocks below stay identical whichever tab is showing.
   */
  const renderSidePanel = (extraClassName?: string) => {
    if (panelTabs.length === 0) return null;
    const motionClass = panelPhase === "open" ? "" : `file-content-panel--${panelPhase}`;
    const className = [extraClassName, motionClass].filter(Boolean).join(" ") || undefined;
    const headerActions = <PanelPinButton pinned={panelPinned} onToggle={togglePanelPinned} />;
    const activeKey = sidePanel ? sidePanelKey(sidePanel) : null;
    const tabStrip = (
      <PanelTabs
        tabs={panelTabInfos}
        activeKey={activeKey}
        onActivate={(key) => dispatchPanel({ type: "activate", key })}
        onClose={(key) => dispatchPanel({ type: "closeTab", key })}
        onCloseAll={() => dispatchPanel({ type: "close" })}
      />
    );
    return panelTabs.map((panel) => {
      const key = sidePanelKey(panel);
      const style = { width: panelWidth, ...(key === activeKey ? null : { display: "none" }) };
      const onClose = () => dispatchPanel({ type: "closeTab", key });
      const common = { headerActions, tabStrip, className, style, onClose };
      if (panel.kind === "file") return <FileContentPanel key={key} relativePath={panel.path} {...common} />;
      if (panel.kind === "diff") {
        return <DiffContentPanel key={key} path={panel.path} filePath={panel.filePath} onOpenFile={openFile} {...common} />;
      }
      if (panel.kind === "terminal") {
        return (
          <TerminalSidePanel
            key={key}
            paneId={panel.id}
            onGoToPane={() => {
              requestTab("terminal");
              requestFocusPane(panel.id);
            }}
            {...common}
          />
        );
      }
      const plugin = pluginsByKey.get(panel.key);
      if (!plugin) return null;
      return (
        <PluginPanel
          key={key}
          plugin={plugin}
          version={pluginsVersion}
          onOpenFile={openFile}
          onOpenTab={(tab) => requestTab(tab as MainTab)}
          {...common}
        />
      );
    });
  };

  return (
    <PaneBranchProvider>
      <div className="chat-shell">
        <SessionSidebar
          sessions={state.sessions}
          activeSessionKey={state.sessionKey}
          onSelectSession={(k) => void selectSession(k)}
          onNewChat={newChat}
          onOpenSettings={() => setSettingsSection("general")}
          onRenameSession={(k, title) => void renameSession(k, title)}
          onDeleteSession={(k) => void deleteSession(k)}
          onOpenFile={openFile}
          onOpenDiff={openDiff}
          activeDiffPath={sidePanel?.kind === "diff" && panelPhase !== "exit" ? sidePanel.path : undefined}
          plugins={plugins}
          onOpenPlugin={openPlugin}
          onOpenPluginTab={openPluginTab}
          onOpenPluginPanel={openPluginPanel}
          onReloadPlugins={() => void reloadPlugins()}
        />
        <PluginToolRuntime plugins={plugins} />
        {/* The panel floats over everything by default; pinned, it takes its own column. */}
        <div className="chat-main" style={sidePanel && panelPinned ? { paddingRight: panelWidth + PANEL_RESIZER_WIDTH } : undefined}>
          <MainTabs
            homeContent={window.yggdrasil.isDefaultProject ? <HomeView /> : undefined}
            workspacesContent={window.yggdrasil.isDefaultProject ? <WorkspacesCanvas visible={activeMainTab === "workspaces"} /> : undefined}
            chatContent={
              <ChatSplit
                chat={
              <>
                <MessageList
                  messages={state.messages}
                  streamingText={state.streamingText}
                  isStreaming={state.isStreaming}
                  isTurnActive={state.isTurnActive}
                  runningTools={runningTools}
                  onOpenFile={openFile}
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
                  onManageAgents={() => setSettingsSection("agent")}
                  providers={state.providers}
                  modelOverride={state.modelOverride}
                  onSelectModel={(override) => dispatch({ type: "SET_MODEL_OVERRIDE", override })}
                  mode={state.mode}
                  onSelectMode={setMode}
                  terminalPanes={terminalPanes}
                  onOpenTerminalPanel={openTerminalPanel}
                />
              </>
                }
              />
            }
            terminalContent={<TerminalContainer />}
            agentFlowContent={<AgentFlowView />}
            worktreesContent={<WorktreesView />}
            workflowsContent={<WorkflowsView />}
            documentsContent={<DocumentsView />}
            browserContent={<BrowserTabView />}
            studioContent={<StudioView />}
            repositoryContent={<RepositoryView />}
            filesContent={<FilesView />}
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
                style={{ right: panelWidth, visibility: panelPhase === "open" ? undefined : "hidden" }}
                onPointerDown={startPanelResize}
              />
              {renderSidePanel("file-content-panel-drawer")}
            </>
          )}
        </div>
        {sidePanel && activeMainTab !== "terminal" && (
          <div
            className="file-content-resizer"
            style={{ right: panelWidth, visibility: panelPhase === "open" ? undefined : "hidden" }}
            onPointerDown={startPanelResize}
          />
        )}
        {sidePanel && activeMainTab !== "terminal" && renderSidePanel()}
        {settingsSection && (
          <SettingsView initialSection={settingsSection} onClose={() => setSettingsSection(null)} />
        )}
      </div>
    </PaneBranchProvider>
  );
}
