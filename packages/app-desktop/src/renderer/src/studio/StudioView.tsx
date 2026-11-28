import { useEffect, useMemo, useRef, useState } from "react";
import { usePlugins } from "../plugins/usePlugins.js";
import { useProjects } from "../projects/useProjects.js";
import { StudioNew } from "./StudioNew.js";
import { useNewWidgetRequests } from "./newWidgetRequest.js";
import { StudioWorkspace } from "./StudioWorkspace.js";
import { pluginGlyph, type StudioTerminalHarness } from "./studioContext.js";
import type { PluginRecord } from "../types.js";
import { useActiveTab } from "../ui/mainTabsStore.js";
import { setSidebarCollapsed, useSidebarCollapsed } from "../ui/sidebarStore.js";
import { useI18n } from "../i18n/index.js";

const RAIL_COLLAPSED_KEY = "ygg.studio.railCollapsed";

function readRailCollapsed(): boolean {
  try {
    // Icon strip by default; the expanded list (with search) is opt-in.
    return localStorage.getItem(RAIL_COLLAPSED_KEY) !== "0";
  } catch {
    return true;
  }
}

/**
 * Focus mode: entering Estudio minimizes the app sidebar to its icon rail;
 * leaving restores whatever it was before — unless the user toggled it
 * themselves while in Estudio, in which case their choice stands.
 */
function useStudioFocusMode(): void {
  const active = useActiveTab();
  const collapsed = useSidebarCollapsed();
  const focusRef = useRef<{ prev: boolean; touched: boolean } | null>(null);

  useEffect(() => {
    if (active === "studio") {
      if (!focusRef.current) {
        focusRef.current = { prev: collapsed, touched: false };
        if (!collapsed) setSidebarCollapsed(true);
      }
    } else if (focusRef.current) {
      const { prev, touched } = focusRef.current;
      focusRef.current = null;
      if (!touched) setSidebarCollapsed(prev);
    }
    // Keyed on the tab only — `collapsed` is read as of the moment Estudio opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    // Closing/quitting while in Estudio never reaches the restore above, and
    // the collapse is persisted — undo it on the way out so the next launch
    // doesn't open with a sidebar the user never minimized.
    const onUnload = () => {
      const f = focusRef.current;
      if (f && !f.touched) setSidebarCollapsed(f.prev);
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  useEffect(() => {
    // Our own collapse lands as `true`; an expand while still here is the user's.
    if (focusRef.current && !collapsed) focusRef.current.touched = true;
  }, [collapsed]);
}

/** How many complementos keep their agent session alive at once (LRU) — notes/features/estudio-redesign.md, decision 1. */
const MAX_ALIVE = 3;

type Props = {
  /** Opens a project-relative file in the app's own viewer (ChatView's openFile). */
  onOpenFile?: (relativePath: string) => void;
};

/**
 * "Estudio" main tab — a workbench for building complementos: describe one
 * (StudioNew creates the draft and hands the description to the agent),
 * build it with the agent next to a live preview, Publicar when it's ready.
 *
 * Up to MAX_ALIVE workspaces stay mounted (hidden when not selected), so
 * hopping between a few complementos doesn't kill their agent sessions; the
 * least recently used one is disposed past that. MainTabs keeps this whole
 * view mounted while switching main tabs, so its state survives too.
 */
export function StudioView({ onOpenFile }: Props) {
  const { t } = useI18n();
  const { plugins } = usePlugins();
  const { projects } = useProjects();
  const projectPath = projects.find((p) => p.id === window.yggdrasil.projectId)?.path ?? null;
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [alive, setAlive] = useState<string[]>([]);
  const [launches, setLaunches] = useState<Record<string, { initialPrompt: string; harness: StudioTerminalHarness }>>({});
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [railCollapsed, setRailCollapsed] = useState(readRailCollapsed);
  useStudioFocusMode();

  const widgetRequests = useNewWidgetRequests();
  // The request already answered, so coming back to the form later doesn't reapply it.
  const [handledRequest, setHandledRequest] = useState(0);
  useEffect(() => {
    if (widgetRequests > handledRequest) setCreating(true);
  }, [widgetRequests, handledRequest]);

  const byKey = useMemo(() => new Map(plugins.map((p) => [p.key, p])), [plugins]);
  const selected = selectedKey ? (byKey.get(selectedKey) ?? null) : null;

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (p: PluginRecord) =>
      !q || p.manifest.name.toLowerCase().includes(q) || p.manifest.id.toLowerCase().includes(q);
    const visible = plugins.filter(matches);
    return {
      drafts: visible.filter((p) => p.manifest.status === "draft"),
      published: visible.filter((p) => p.manifest.status !== "draft"),
    };
  }, [plugins, query]);

  const toggleRail = () => {
    setRailCollapsed((c) => {
      try {
        localStorage.setItem(RAIL_COLLAPSED_KEY, c ? "0" : "1");
      } catch {
        // storage unavailable: the preference just won't survive a restart
      }
      return !c;
    });
  };

  const closeCreate = () => {
    setCreating(false);
    setHandledRequest(widgetRequests);
  };

  const select = (key: string) => {
    setSelectedKey(key);
    closeCreate();
    setAlive((prev) => [...prev.filter((k) => k !== key), key].slice(-MAX_ALIVE));
  };

  const forget = (key: string) => {
    setAlive((prev) => prev.filter((k) => k !== key));
    setSelectedKey((k) => (k === key ? null : k));
  };

  const startCreate = () => {
    setCreating(true);
  };

  const handleCreated = (record: PluginRecord, launch: { initialPrompt: string; harness: StudioTerminalHarness }) => {
    setLaunches((prev) => ({ ...prev, [record.key]: launch }));
    select(record.key);
  };

  const renderItem = (p: PluginRecord) => {
    const active = !creating && p.key === selectedKey;
    const live = alive.includes(p.key);
    return (
      <li key={p.key}>
        <button
          type="button"
          className={`studio-rail-item${active ? " active" : ""}`}
          onClick={() => select(p.key)}
          title={p.error ? `${p.manifest.name} — ${p.error}` : p.manifest.name}
          aria-label={railCollapsed ? p.manifest.name : undefined}
          aria-current={active ? "true" : undefined}
        >
          <span className={`studio-glyph${p.error ? " studio-glyph-error" : ""}`}>{pluginGlyph(p)}</span>
          {!railCollapsed && (
            <>
              <span className="studio-rail-name">{p.manifest.name}</span>
              {p.error ? (
                <span className="studio-rail-error">{t("studio.tag.error")}</span>
              ) : (
                p.scope === "global" && <span className="scope-tag">{t("studio.tag.global")}</span>
              )}
              {live && <span className="studio-live-dot" title={t("studio.workspace.sessionAlive")} />}
            </>
          )}
          {railCollapsed && (p.error || p.manifest.status === "draft") && (
            <span className={`studio-rail-status-dot${p.error ? " error" : ""}`} />
          )}
          {railCollapsed && live && <span className="studio-rail-live-dot" />}
        </button>
      </li>
    );
  };

  // `first`: no separator above the strip's first group.
  const renderGroup = (label: string, items: PluginRecord[], first: boolean) =>
    items.length > 0 && (
      <>
        {railCollapsed ? (
          !first && <li className="studio-rail-sep" aria-hidden="true" />
        ) : (
          <li className="studio-rail-group">
            <span>{label}</span>
            <span>{items.length}</span>
          </li>
        )}
        {items.map(renderItem)}
      </>
    );

  const newButton = (
    <button
      type="button"
      className={`studio-new-btn${creating ? " active" : ""}`}
      onClick={startCreate}
      aria-label={t("studio.view.newLabel")}
      title={t("studio.view.newLabel")}
    >
      +
    </button>
  );

  return (
    <div className="studio-view">
      <aside className={`studio-rail${railCollapsed ? " collapsed" : ""}`}>
        {!railCollapsed && (
          <div className="studio-rail-top">
            <input
              className="studio-rail-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("studio.view.search")}
              aria-label={t("studio.view.search")}
            />
            {newButton}
          </div>
        )}
        <ul className="studio-rail-list">
          {renderGroup(t("studio.view.drafts"), groups.drafts, true)}
          {renderGroup(t("studio.view.published"), groups.published, groups.drafts.length === 0)}
          {plugins.length === 0 && !railCollapsed && <li className="muted studio-rail-note">{t("studio.view.none")}</li>}
          {plugins.length > 0 && groups.drafts.length + groups.published.length === 0 && !railCollapsed && (
            <li className="muted studio-rail-note">{t("studio.view.noMatches")}</li>
          )}
        </ul>
        {railCollapsed && newButton}
        <button
          type="button"
          className="studio-rail-fold"
          onClick={toggleRail}
          aria-label={railCollapsed ? t("studio.view.expandList") : t("studio.view.collapseList")}
          title={railCollapsed ? t("studio.view.expandList") : t("studio.view.collapseList")}
        >
          {railCollapsed ? "⟩" : `⟨ ${t("studio.view.collapseList")}`}
        </button>
      </aside>
      <div className="studio-main">
        {creating && (
          <StudioNew
            plugins={plugins}
            onCancel={closeCreate}
            widgetRequest={widgetRequests > handledRequest ? widgetRequests : 0}
            onCreated={handleCreated}
          />
        )}
        {projectPath &&
          alive.map((key) => {
            const plugin = byKey.get(key);
            if (!plugin) return null;
            const shown = !creating && key === selectedKey;
            return (
              <div key={key} className="studio-workspace-slot" style={{ display: shown ? "flex" : "none" }}>
                <StudioWorkspace
                  plugin={plugin}
                  projectPath={projectPath}
                  launch={launches[key]}
                  onLaunchConsumed={() =>
                    setLaunches((prev) => {
                      const { [key]: _consumed, ...rest } = prev;
                      return rest;
                    })
                  }
                  onDeleted={() => forget(key)}
                  onOpenFile={onOpenFile}
                />
              </div>
            );
          })}
        {!creating && !selected && (
          <div className="studio-empty">
            <p className="muted">{plugins.length === 0 ? t("studio.view.emptyFirst") : t("studio.view.empty")}</p>
            <button type="button" className="studio-primary-btn" onClick={startCreate}>
              {t("studio.view.newLabel")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
