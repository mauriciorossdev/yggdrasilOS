import { useEffect, useState, type ReactNode } from "react";
import { onRequestTab } from "./mainTabsBridge.js";
import { notifyTerminalTabVisible, requestLoadTeam, requestNewTerminal } from "../terminal/terminalBridge.js";
import { notifyBrowserTabVisibleChange } from "../browser/browserTabBridge.js";
import { TeamsMenu } from "../terminal/TeamsMenu.js";
import type { AgentTeam } from "../types.js";

export type BuiltinMainTab = "chat" | "terminal" | "agentFlow" | "workflows" | "documents" | "browser" | "studio" | "repository";
/** `plugin:<scope>:<id>` (PluginRecord.key) for a complemento opened as a pestaña — see ChatView.tsx's openPluginTabs and extraTabs. */
export type MainTab = BuiltinMainTab | `plugin:${string}`;

/** One open complemento pestaña — ChatView builds this list from its own openPluginTabs state; MainTabs itself has no idea what a plugin is beyond rendering whatever's handed to it. */
export type ExtraTab = {
  id: MainTab;
  label: string;
  icon?: ReactNode;
  content: ReactNode;
  onClose: () => void;
};

type Props = {
  chatContent: ReactNode;
  terminalContent: ReactNode;
  agentFlowContent: ReactNode;
  workflowsContent?: ReactNode;
  documentsContent?: ReactNode;
  browserContent?: ReactNode;
  studioContent?: ReactNode;
  repositoryContent?: ReactNode;
  extraTabs?: ExtraTab[];
  /** Lets a parent (ChatView) know which tab is active — e.g. to render the file viewer as an overlay drawer only over Terminal. */
  onActiveTabChange?: (tab: MainTab) => void;
};

/**
 * All three tabs stay mounted for the life of the window — only `display`
 * toggles. Unmounting the terminal tab on switch would kill its xterm
 * instances/scrollback along with it (the pty processes themselves live in
 * the main process regardless, but there'd be nothing left to reattach to),
 * and unmounting chat would lose in-flight streaming state. This is the
 * entire mechanism behind "all tabs persist" — no reducer changes needed.
 * `extraTabs` (complemento pestañas) follow the same rule: a plugin's iframe
 * keeps running (and any postMessage-held state stays intact) while its tab
 * is merely hidden, not unmounted.
 */
export function MainTabs({
  chatContent,
  terminalContent,
  agentFlowContent,
  workflowsContent,
  documentsContent,
  browserContent,
  studioContent,
  repositoryContent,
  extraTabs,
  onActiveTabChange,
}: Props) {
  const [active, setActive] = useState<MainTab>("chat");
  const [teams, setTeams] = useState<AgentTeam[]>([]);

  // "Load into Terminal" (Agent Flow tab) jumps the user to the Terminal tab
  // once panes are spawned — see chat/mainTabsBridge.ts. A plugin's own
  // ygg.app.openTab call (pluginHost.ts) rides the same bridge, generalized
  // to any MainTab id instead of just "terminal".
  useEffect(() => onRequestTab((tab) => setActive(tab)), []);

  // browser_open (an agent) navigated the Browser tab and wants the user
  // looking at it too — see paneControlServer.ts's POST /browser/open.
  useEffect(() => window.yggdrasil.browserTab.onRequestShow(() => setActive("browser")), []);

  // A plugin pestaña the user (or a plugin) had open can vanish out from
  // under `active` — its folder deleted, or ChatView pruning openPluginTabs
  // after a plugins:changed event. Falls back to Chat rather than showing a
  // blank panel with no matching button highlighted.
  useEffect(() => {
    if (active.startsWith("plugin:") && !extraTabs?.some((t) => t.id === active)) setActive("chat");
  }, [active, extraTabs]);

  useEffect(() => onActiveTabChange?.(active), [active, onActiveTabChange]);

  // Tell TerminalContainer to re-fit every pane once this tab is actually
  // visible — see terminalBridge.ts's onTerminalTabVisible for why.
  useEffect(() => {
    if (active === "terminal") {
      notifyTerminalTabVisible();
      // Refetch each time in case a team was just saved from Agent Flow.
      void window.yggdrasil.agentTeams.list().then(setTeams);
    }
  }, [active]);

  // Same reasoning as the terminal effect above, but for browserTabBridge.ts
  // — a WebContentsView is a native layer, not a DOM node, so it needs an
  // explicit attach/detach signal instead of riding along with CSS
  // display:none like every other panel here.
  useEffect(() => {
    notifyBrowserTabVisibleChange(active === "browser");
  }, [active]);

  return (
    <div className="main-tabs">
      <div className="main-tabs-bar">
        <button
          type="button"
          className={`main-tab${active === "chat" ? " active" : ""}`}
          onClick={() => setActive("chat")}
        >
          Chat
        </button>
        <div className="main-tab-group">
          <button
            type="button"
            className={`main-tab${active === "terminal" ? " active" : ""}`}
            onClick={() => setActive("terminal")}
          >
            Terminal
          </button>
          {active === "terminal" && (
            <button
              type="button"
              className="main-tab-add"
              title="New terminal"
              onClick={() => requestNewTerminal()}
            >
              +
            </button>
          )}
          {active === "terminal" && (
            <TeamsMenu teams={teams} label="Teams" title="Load a saved team" onLoad={requestLoadTeam} onDeleted={setTeams} />
          )}
        </div>
        <button
          type="button"
          className={`main-tab${active === "agentFlow" ? " active" : ""}`}
          onClick={() => setActive("agentFlow")}
        >
          Agent Flow
        </button>
        <button
          type="button"
          className={`main-tab${active === "workflows" ? " active" : ""}`}
          onClick={() => setActive("workflows")}
        >
          Workflows
        </button>
        <button
          type="button"
          className={`main-tab${active === "documents" ? " active" : ""}`}
          onClick={() => setActive("documents")}
        >
          Documents
        </button>
        <button
          type="button"
          className={`main-tab${active === "browser" ? " active" : ""}`}
          onClick={() => setActive("browser")}
        >
          Browser
        </button>
        <button
          type="button"
          className={`main-tab${active === "studio" ? " active" : ""}`}
          onClick={() => setActive("studio")}
        >
          Estudio
        </button>
        <button
          type="button"
          className={`main-tab${active === "repository" ? " active" : ""}`}
          onClick={() => setActive("repository")}
        >
          Repositorio
        </button>

        {extraTabs?.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`main-tab main-tab-closable${active === t.id ? " active" : ""}`}
            onClick={() => setActive(t.id)}
          >
            {t.icon}
            {t.label}
            <span
              className="main-tab-close"
              title="Cerrar"
              onClick={(e) => {
                e.stopPropagation();
                t.onClose();
              }}
            >
              ×
            </span>
          </button>
        ))}

        <div className="main-tabs-bar-spacer" />
      </div>
        <div className="main-tab-panel" style={{ display: active === "chat" ? "flex" : "none" }}>
          {chatContent}
        </div>
        <div className="main-tab-panel" style={{ display: active === "terminal" ? "flex" : "none" }}>
          {terminalContent}
        </div>
        <div className="main-tab-panel" style={{ display: active === "agentFlow" ? "flex" : "none" }}>
          {agentFlowContent}
        </div>
        <div className="main-tab-panel" style={{ display: active === "workflows" ? "flex" : "none" }}>
          {workflowsContent}
        </div>
        <div className="main-tab-panel" style={{ display: active === "documents" ? "flex" : "none" }}>
          {documentsContent}
        </div>
        <div className="main-tab-panel" style={{ display: active === "browser" ? "flex" : "none" }}>
          {browserContent}
        </div>
        <div className="main-tab-panel" style={{ display: active === "studio" ? "flex" : "none" }}>
          {studioContent}
        </div>
        <div className="main-tab-panel" style={{ display: active === "repository" ? "flex" : "none" }}>
          {repositoryContent}
        </div>
        {extraTabs?.map((t) => (
          <div key={t.id} className="main-tab-panel" style={{ display: active === t.id ? "flex" : "none" }}>
            {t.content}
          </div>
        ))}
    </div>
  );
}
