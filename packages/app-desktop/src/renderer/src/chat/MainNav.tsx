import { useEffect, type ReactNode } from "react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ChatBubbleLeftRightIcon,
  CodeBracketIcon,
  CommandLineIcon,
  DocumentTextIcon,
  GlobeAltIcon,
  HomeIcon,
  QueueListIcon,
  RectangleGroupIcon,
  ShareIcon,
  SparklesIcon,
} from "@heroicons/react/20/solid";
import { NavItem } from "../ui/index.js";
import { toggleTerminalsList, useShowWorkflows, useTerminalsListOpen } from "../ui/sidebarStore.js";
import { setBrowserTabCovered } from "../browser/browserTabBridge.js";
import { requestFocusPane, useTerminalPanes } from "../terminal/terminalPanesStore.js";
import { useI18n } from "../i18n/index.js";
import {
  setActiveTab,
  useActiveTab,
  useExtraTabs,
  type BuiltinMainTab,
} from "../ui/mainTabsStore.js";

const SECTIONS: BuiltinMainTab[] = ["chat", "terminal", "agentFlow", "worktrees", "workflows", "documents", "browser", "studio", "repository"];

const SECTION_ICONS: Partial<Record<BuiltinMainTab, typeof HomeIcon>> = {
  home: HomeIcon,
  chat: ChatBubbleLeftRightIcon,
  terminal: CommandLineIcon,
  agentFlow: ShareIcon,
  worktrees: RectangleGroupIcon,
  workflows: QueueListIcon,
  documents: DocumentTextIcon,
  browser: GlobeAltIcon,
  studio: SparklesIcon,
  repository: CodeBracketIcon,
};

function sectionIcon(id: BuiltinMainTab): ReactNode {
  const Icon = SECTION_ICONS[id];
  return Icon ? <Icon className="hero-icon main-nav-icon" /> : null;
}

/** Open terminal panes: inline under the Terminal entry when the sidebar is expanded, a hover flyout in the icon rail. */
function TerminalPaneList({ onPick }: { onPick?: () => void }) {
  const { t } = useI18n();
  const { panes, activeId } = useTerminalPanes();
  return (
    <ul className="main-nav-panes">
      {panes.map((p) => (
        <li key={p.id}>
          <button
            type="button"
            className={`main-nav-pane${p.id === activeId ? " main-nav-pane--active" : ""}${p.minimized ? " main-nav-pane--minimized" : ""}`}
            title={p.minimized ? t("chat.mainNav.minimized", { title: p.title }) : p.title}
            onClick={() => {
              requestFocusPane(p.id);
              onPick?.();
            }}
          >
            <span className="main-nav-pane-title">{p.title}</span>
            {(p.docked || p.command) && <span className="main-nav-pane-cmd">{p.docked ? t("chat.mainNav.paneBrowser") : p.command}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The main sections as a vertical list at the top of the sidebar (it used to be
 * a row of outlined tabs above the content). Home only exists in the main
 * window; open complemento tabs follow the built-in sections with a close ×.
 * `collapsed` shows just the icons (the label moves to the tooltip).
 */
export function MainNav({ collapsed = false }: { collapsed?: boolean }) {
  const { t } = useI18n();
  const tabLabel = (id: BuiltinMainTab) => t(`chat.mainNav.tab_${id}` as const);
  const active = useActiveTab();
  const extraTabs = useExtraTabs();
  const showWorkflows = useShowWorkflows();
  const isMainWindow = window.yggdrasil.isDefaultProject;

  const { panes } = useTerminalPanes();
  // Never leave the page frozen if the entry goes away mid-hover (sidebar expanded, panes closed).
  useEffect(() => () => setBrowserTabCovered(false), [collapsed]);
  const listOpen = useTerminalsListOpen();

  const terminalEntry = () => {
    const item = (
      <NavItem
        active={active === "terminal"}
        icon={sectionIcon("terminal")}
        onClick={() => setActiveTab("terminal")}
        title={collapsed && panes.length === 0 ? tabLabel("terminal") : undefined}
        aria-label={tabLabel("terminal")}
      >
        {!collapsed && tabLabel("terminal")}
      </NavItem>
    );
    if (collapsed) {
      // Hover/focus flyout beside the rail. (A native Browser-tab view paints over it — accepted; the icon itself still navigates.)
      return (
        <div
          key="terminal"
          className="main-nav-flyout-host"
          // The flyout can't draw over the Browser tab's native view, so that view
          // is swapped for a still image while the pointer/focus is on this entry.
          onMouseEnter={() => panes.length > 0 && setBrowserTabCovered(true)}
          onMouseLeave={() => setBrowserTabCovered(false)}
          onFocus={() => panes.length > 0 && setBrowserTabCovered(true)}
          onBlur={() => setBrowserTabCovered(false)}
        >
          {item}
          {panes.length > 0 && (
            <>
              <span className="main-nav-count" aria-hidden>
                {panes.length}
              </span>
              <div className="main-nav-flyout" role="menu" aria-label={t("chat.mainNav.openTerminals")}>
                <TerminalPaneList />
              </div>
            </>
          )}
        </div>
      );
    }
    return (
      <div key="terminal" className="main-nav-group">
        <div className="main-nav-group-row">
          {item}
          {panes.length > 0 && (
            <button
              type="button"
              className="icon-btn main-nav-twisty"
              onClick={toggleTerminalsList}
              aria-expanded={listOpen}
              aria-label={listOpen ? t("chat.mainNav.hideTerminals") : t("chat.mainNav.showTerminals")}
              title={listOpen ? t("chat.mainNav.hideTerminals") : t("chat.mainNav.showTerminalsCount", { count: panes.length })}
            >
              {listOpen ? <ChevronDownIcon className="hero-icon" /> : <ChevronRightIcon className="hero-icon" />}
            </button>
          )}
        </div>
        {listOpen && panes.length > 0 && <TerminalPaneList />}
      </div>
    );
  };

  const builtin = (id: BuiltinMainTab) =>
    id === "terminal" ? (
      terminalEntry()
    ) : (
    <NavItem
      key={id}
      active={active === id}
      icon={sectionIcon(id)}
      onClick={() => setActiveTab(id)}
      title={collapsed ? tabLabel(id) : undefined}
      aria-label={tabLabel(id)}
    >
      {!collapsed && tabLabel(id)}
    </NavItem>
    );

  return (
    <nav className="main-nav" aria-label={t("chat.mainNav.sections")}>
      {isMainWindow && builtin("home")}
      {SECTIONS.filter((id) => id !== "workflows" || showWorkflows).map(builtin)}
      {extraTabs.map((tab) => (
        <NavItem
          key={tab.id}
          active={active === tab.id}
          icon={tab.icon ?? <span className="main-nav-icon main-nav-initial">{tab.label.charAt(0).toUpperCase()}</span>}
          onClick={() => setActiveTab(tab.id)}
          title={collapsed ? tab.label : undefined}
          aria-label={tab.label}
        >
          {!collapsed && (
            <>
              <span className="main-nav-label">{tab.label}</span>
              <span
                className="main-nav-close"
                title={t("chat.mainNav.close")}
                onClick={(e) => {
                  e.stopPropagation();
                  tab.onClose();
                }}
              >
                ×
              </span>
            </>
          )}
        </NavItem>
      ))}
    </nav>
  );
}
