import { lazy, Suspense } from "react";
import { XMarkIcon } from "@heroicons/react/20/solid";
import { activateWorkspaceTab, closeWorkspaceTab, useWorkspace, type WorkspaceTab } from "./workspaceStore.js";
import { useI18n } from "../i18n/index.js";

// Univer is large: it is only loaded the first time a spreadsheet is opened.
const SheetEditor = lazy(() => import("./SheetEditor.js"));
const DocEditor = lazy(() => import("./DocEditor.js"));
const DeckEditor = lazy(() => import("./DeckEditor.js"));

function labelOf(tab: WorkspaceTab): string {
  return tab.path.split("/").pop() ?? tab.path;
}

/** The tabs of the container beside the chat. Every tab stays mounted (hidden when inactive) so switching never loses an editor's state. */
export function WorkspaceView() {
  const { t } = useI18n();
  const { tabs, activeId } = useWorkspace();

  return (
    <div className="workspace">
      <div className="workspace-tabs" role="tablist">
        {tabs.map((tab) => (
          <div key={tab.id} className={`workspace-tab${tab.id === activeId ? " active" : ""}`}>
            <button
              type="button"
              role="tab"
              aria-selected={tab.id === activeId}
              className="workspace-tab-label"
              title={tab.path}
              onClick={() => activateWorkspaceTab(tab.id)}
            >
              {labelOf(tab)}
            </button>
            <button
              type="button"
              className="workspace-tab-close"
              aria-label={t("workspace.closeTab")}
              title={t("workspace.closeTab")}
              onClick={() => closeWorkspaceTab(tab.id)}
            >
              <XMarkIcon className="hero-icon" />
            </button>
          </div>
        ))}
      </div>
      <div className="workspace-body">
        {tabs.map((tab) => (
          <div key={tab.id} className="workspace-pane" style={{ display: tab.id === activeId ? "flex" : "none" }}>
            <Suspense fallback={<p className="muted workspace-loading">{t("workspace.loading")}</p>}>
              {tab.kind === "sheet" && <SheetEditor path={tab.path} active={tab.id === activeId} />}
              {tab.kind === "doc" && <DocEditor path={tab.path} active={tab.id === activeId} />}
              {tab.kind === "deck" && <DeckEditor path={tab.path} active={tab.id === activeId} />}
            </Suspense>
          </div>
        ))}
      </div>
    </div>
  );
}
