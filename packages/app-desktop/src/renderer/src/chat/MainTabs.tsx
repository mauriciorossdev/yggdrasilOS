import { useEffect, type ReactNode } from "react";
import { onRequestTab } from "./mainTabsBridge.js";
import { notifyTerminalTabVisible } from "../terminal/terminalBridge.js";
import { notifyBrowserTabVisibleChange } from "../browser/browserTabBridge.js";
import {
  resolveActiveTab,
  setActiveTab,
  setExtraTabs,
  useActiveTab,
  type BuiltinMainTab,
  type MainTab,
} from "../ui/mainTabsStore.js";

export type { BuiltinMainTab, MainTab };

/** One open complemento tab — ChatView builds this list from its own openPluginTabs state; MainTabs itself has no idea what a plugin is beyond rendering whatever's handed to it. */
export type ExtraTab = {
  id: MainTab;
  label: string;
  icon?: ReactNode;
  content: ReactNode;
  onClose: () => void;
};

type Props = {
  homeContent?: ReactNode;
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
 * The panel host. Which section is showing lives in ui/mainTabsStore (the
 * sidebar's MainNav switches it); this only renders the panels.
 *
 * All panels stay mounted for the life of the window — only `display`
 * toggles. Unmounting the terminal tab on switch would kill its xterm
 * instances/scrollback along with it (the pty processes themselves live in
 * the main process regardless, but there'd be nothing left to reattach to),
 * and unmounting chat would lose in-flight streaming state. This is the
 * entire mechanism behind "all tabs persist" — no reducer changes needed.
 * `extraTabs` (complemento tabs) follow the same rule: a plugin's iframe
 * keeps running (and any postMessage-held state stays intact) while its tab
 * is merely hidden, not unmounted.
 */
export function MainTabs({
  homeContent,
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
  const isMainWindow = window.yggdrasil.isDefaultProject;
  const active = useActiveTab();

  // Hand the navigation (MainNav) the tabs it should list.
  useEffect(() => {
    setExtraTabs((extraTabs ?? []).map(({ id, label, icon, onClose }) => ({ id, label, icon, onClose })));
  }, [extraTabs]);

  // "Load into Terminal" (Agent Flow tab) jumps the user to the Terminal tab
  // once panes are spawned — see chat/mainTabsBridge.ts. A plugin's own
  // ygg.app.openTab call (pluginHost.ts) rides the same bridge, generalized
  // to any MainTab id instead of just "terminal".
  useEffect(() => onRequestTab(setActiveTab), []);

  // browser_open (an agent) navigated the Browser tab and wants the user
  // looking at it too — see paneControlServer.ts's POST /browser/open.
  useEffect(() => window.yggdrasil.browserTab.onRequestShow(() => setActiveTab("browser")), []);

  // A complemento tab can vanish out from under `active` (its folder deleted,
  // or ChatView pruning openPluginTabs after plugins:changed), and Home only
  // exists in the main window: fall back to Chat instead of a blank panel.
  useEffect(() => {
    const resolved = resolveActiveTab(active, (extraTabs ?? []).map((t) => t.id), isMainWindow);
    if (resolved !== active) setActiveTab(resolved);
  }, [active, extraTabs, isMainWindow]);

  useEffect(() => onActiveTabChange?.(active), [active, onActiveTabChange]);

  // Tell TerminalContainer to re-fit every pane once this tab is actually
  // visible — see terminalBridge.ts's onTerminalTabVisible for why.
  useEffect(() => {
    if (active === "terminal") notifyTerminalTabVisible();
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
      {isMainWindow && (
        <div className="main-tab-panel" style={{ display: active === "home" ? "flex" : "none" }}>
          {homeContent}
        </div>
      )}
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
