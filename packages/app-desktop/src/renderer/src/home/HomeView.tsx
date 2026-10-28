import { useEffect, useMemo, useState } from "react";
import { FolderOpenIcon, PlusIcon } from "@heroicons/react/20/solid";
import type { ProjectRecord } from "../types.js";
import { ProjectContextMenu } from "../chat/ProjectContextMenu.js";
import { useProjects } from "../projects/useProjects.js";
import { formatOpenedAt } from "./formatOpenedAt.js";

// Launch pad: every known project as a button, most recently opened first.
// The sidebar's project list is only shown in the default workspace window, so
// this is also how a project window gets to its siblings.
export function HomeView() {
  const { projects, error, refresh, open, openExisting, createNew, rename, reveal, openInIde, clone, remove, purge } =
    useProjects();
  const [menu, setMenu] = useState<{ project: ProjectRecord; x: number; y: number } | null>(null);

  // This window stays mounted while other windows open projects, so the order
  // would go stale; refresh whenever the user comes back to it.
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const sorted = useMemo(() => [...projects].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt), [projects]);

  return (
    <div className="home-view">
      <div className="home-header">
        <h2>Proyectos</h2>
        <div className="home-actions">
          <button type="button" className="home-action" onClick={() => void openExisting()}>
            <FolderOpenIcon className="hero-icon" /> Abrir carpeta…
          </button>
          <button type="button" className="home-action" onClick={() => void createNew()}>
            <PlusIcon className="hero-icon" /> Nuevo proyecto…
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="home-grid">
        {sorted.map((p) => (
          <button
            key={p.id}
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
              {p.id === window.yggdrasil.projectId ? "Esta ventana · " : ""}
              {formatOpenedAt(p.lastOpenedAt)}
            </span>
          </button>
        ))}
        {sorted.length === 0 && <p className="muted">Aún no hay proyectos.</p>}
      </div>
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
              if (!opened) window.alert("No hay un IDE configurado. Configúralo en Settings → IDE.");
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
