import { NavItem } from "../ui/index.js";
import {
  MAIN_TAB_LABELS,
  setActiveTab,
  useActiveTab,
  useExtraTabs,
  type BuiltinMainTab,
} from "../ui/mainTabsStore.js";

const SECTIONS: BuiltinMainTab[] = ["chat", "terminal", "agentFlow", "workflows", "documents", "browser", "studio", "repository"];

/**
 * The main sections as a vertical list at the top of the sidebar (it used to be
 * a row of outlined tabs above the content). Home only exists in the main
 * window; open complemento tabs follow the built-in sections with a close ×.
 */
export function MainNav() {
  const active = useActiveTab();
  const extraTabs = useExtraTabs();
  const isMainWindow = window.yggdrasil.isDefaultProject;

  return (
    <nav className="main-nav" aria-label="Secciones">
      {isMainWindow && (
        <NavItem active={active === "home"} onClick={() => setActiveTab("home")}>
          {MAIN_TAB_LABELS.home}
        </NavItem>
      )}
      {SECTIONS.map((id) => (
        <NavItem key={id} active={active === id} onClick={() => setActiveTab(id)}>
          {MAIN_TAB_LABELS[id]}
        </NavItem>
      ))}
      {extraTabs.map((tab) => (
        <NavItem key={tab.id} active={active === tab.id} icon={tab.icon} onClick={() => setActiveTab(tab.id)}>
          <span className="main-nav-label">{tab.label}</span>
          <span
            className="main-nav-close"
            title="Cerrar"
            onClick={(e) => {
              e.stopPropagation();
              tab.onClose();
            }}
          >
            ×
          </span>
        </NavItem>
      ))}
    </nav>
  );
}
