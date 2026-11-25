import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownTrayIcon, FolderOpenIcon, MagnifyingGlassIcon, PlusIcon, XMarkIcon } from "@heroicons/react/20/solid";
import type { ProjectRecord } from "../types.js";
import { ProjectContextMenu } from "../chat/ProjectContextMenu.js";
import { useProjects } from "../projects/useProjects.js";
import { filterProjects } from "./filterProjects.js";
import { formatOpenedAt } from "./formatOpenedAt.js";
import { useI18n } from "../i18n/index.js";
import { SettingsView } from "../settings/SettingsView.js";
import { CloneRepoDialog } from "./CloneRepoDialog.js";
import { useFlipReorder } from "./useFlipReorder.js";

// Launch pad: every known project as a button, most recently opened first.
// The sidebar's project list is only shown in the default workspace window, so
// this is also how a project window gets to its siblings.
export function HomeView() {
  const { t } = useI18n();
  const { projects, error, refresh, open, openExisting, createNew, rename, reveal, openInIde, clone, remove, purge } =
    useProjects();
  const [menu, setMenu] = useState<{ project: ProjectRecord; x: number; y: number } | null>(null);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [connectorsOpen, setConnectorsOpen] = useState(false);

  // This window stays mounted while other windows open projects, so the order
  // would go stale; refresh whenever the user comes back to it.
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const [query, setQuery] = useState("");
  const sorted = useMemo(() => [...projects].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt), [projects]);
  const visible = useMemo(() => filterProjects(sorted, query), [sorted, query]);
  // Opening a project bumps it to the front: slide the cards there instead of jumping.
  const gridRef = useRef<HTMLDivElement>(null);
  useFlipReorder(gridRef, visible.map((p) => p.id).join("|"));

  return (
    <div className="home-view">
      <div className="home-header">
        <h2>{t("home.title")}</h2>
        <label className="home-search">
          <MagnifyingGlassIcon className="hero-icon home-search-icon" />
          <input
            type="search"
            className="home-search-input"
            placeholder={t("home.searchPlaceholder")}
            aria-label={t("home.searchAria")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
              if (e.key === "Enter" && visible.length === 1) void open(visible[0]!.id);
            }}
          />
          {query && (
            <button type="button" className="home-search-clear" onClick={() => setQuery("")} aria-label={t("home.clearAria")} title={t("home.clearTitle")}>
              <XMarkIcon className="hero-icon" />
            </button>
          )}
        </label>
        <div className="home-actions">
          <button type="button" className="home-action" onClick={() => void openExisting()}>
            <FolderOpenIcon className="hero-icon" /> {t("home.openFolder")}
          </button>
          <button type="button" className="home-action" onClick={() => void createNew()}>
            <PlusIcon className="hero-icon" /> {t("home.newProject")}
          </button>
          <button type="button" className="home-action" onClick={() => setCloneOpen(true)}>
            <ArrowDownTrayIcon className="hero-icon" /> {t("home.cloneRepo")}
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="home-grid" ref={gridRef}>
        {visible.map((p) => (
          <button
            key={p.id}
            data-flip-id={p.id}
            type="button"
            className={`home-card${p.id === window.yggdrasil.projectId ? " current" : ""}`}
            style={p.color ? { borderColor: p.color } : undefined}
            onClick={() => void open(p.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ project: p, x: e.clientX, y: e.clientY });
            }}
            title={p.path}
          >
            <span className="home-card-name">
              <span className="project-list-color-dot" style={{ background: p.color || "transparent" }} />
              <span className="home-card-name-text">{p.name}</span>
            </span>
            <span className="home-card-path" title={p.path}>
              {p.path}
            </span>
            <span className="home-card-time">
              {p.id === window.yggdrasil.projectId ? t("home.thisWindow") : ""}
              {formatOpenedAt(p.lastOpenedAt)}
            </span>
          </button>
        ))}
        {sorted.length === 0 && <p className="muted">{t("home.empty")}</p>}
        {sorted.length > 0 && visible.length === 0 && <p className="muted">{t("home.noMatch", { query: query.trim() })}</p>}
      </div>
      {cloneOpen && (
        <CloneRepoDialog
          onClose={() => setCloneOpen(false)}
          onCloned={() => void refresh()}
          onOpenConnectors={() => {
            setCloneOpen(false);
            setConnectorsOpen(true);
          }}
        />
      )}
      {connectorsOpen && (
        <SettingsView
          initialSection="connectors"
          onClose={() => {
            setConnectorsOpen(false);
            // Back to the dialog, which re-checks the connection on mount.
            setCloneOpen(true);
          }}
        />
      )}
      {menu && (
        <ProjectContextMenu
          project={menu.project}
          locked={menu.project.id === window.yggdrasil.projectId || menu.project.id === window.yggdrasil.defaultProjectId}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onOpen={(id) => void open(id)}
          onReveal={(id) => void reveal(id)}
          onOpenInIde={(id) =>
            void openInIde(id).then((opened) => {
              if (!opened) window.alert(t("home.noIde"));
            })
          }
          onClone={(id) => void clone(id)}
          onRename={(id, name) => void rename(id, name)}
          onRemove={(id) => void remove(id)}
          onPurge={(id) => void purge(id)}
        />
      )}
    </div>
  );
}
