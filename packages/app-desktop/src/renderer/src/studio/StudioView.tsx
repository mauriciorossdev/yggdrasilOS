import { useMemo, useState } from "react";
import { usePlugins } from "../plugins/usePlugins.js";
import { useProjects } from "../projects/useProjects.js";
import { StudioCreateForm } from "./StudioCreateForm.js";
import { StudioWorkspace } from "./StudioWorkspace.js";
import type { PluginRecord } from "../types.js";

/**
 * "Estudio" main tab — a workshop for building complementos: describe one
 * via a form (creates it as a draft), then author it (terminal or chat, R3/R4)
 * with a live test/preview (R2) alongside, and Publicar when it's ready.
 *
 * Self-contained: no props from ChatView, its own `usePlugins()` (the
 * UNFILTERED list — unlike PluginsSection's sidebar, drafts are exactly
 * what this view is for). No layout persistence needed either — MainTabs
 * keeps every tab mounted permanently (display:none, never unmounted), so
 * this component's own state already survives switching away and back.
 */
export function StudioView() {
  const { plugins } = usePlugins();
  const { projects } = useProjects();
  const projectPath = projects.find((p) => p.id === window.yggdrasil.projectId)?.path ?? null;
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const selected = useMemo(() => plugins.find((p) => p.key === selectedKey) ?? null, [plugins, selectedKey]);

  const select = (key: string) => {
    setSelectedKey(key);
    setShowCreateForm(false);
  };

  const handleCreated = (record: PluginRecord) => {
    setShowCreateForm(false);
    setSelectedKey(record.key);
  };

  return (
    <div className="studio-view">
      <aside className="studio-rail">
        <button
          type="button"
          className="studio-new-btn"
          onClick={() => {
            setShowCreateForm(true);
            setSelectedKey(null);
          }}
        >
          + Nuevo
        </button>
        <ul className="studio-rail-list">
          {plugins.map((p) => (
            <li key={p.key}>
              <button
                type="button"
                className={`studio-rail-item${!showCreateForm && p.key === selectedKey ? " active" : ""}`}
                onClick={() => select(p.key)}
                title={p.dir}
              >
                <span className="plugin-icon">
                  {p.manifest.icon && !p.manifest.icon.includes(".") ? p.manifest.icon : "🧩"}
                </span>
                {p.manifest.name}
                {p.manifest.status === "draft" && <span className="scope-tag plugin-draft-tag">borrador</span>}
                {p.scope === "global" && <span className="scope-tag">global</span>}
                {p.error && <span className="scope-tag plugin-error-tag">error</span>}
              </button>
            </li>
          ))}
          {plugins.length === 0 && <li className="muted">Sin complementos todavía</li>}
        </ul>
      </aside>
      <div className="studio-main">
        {showCreateForm && (
          <StudioCreateForm onCancel={() => setShowCreateForm(false)} onCreated={handleCreated} />
        )}
        {!showCreateForm && selected && projectPath && (
          <StudioWorkspace
            key={selected.key}
            plugin={selected}
            projectPath={projectPath}
            onDeleted={() => setSelectedKey(null)}
          />
        )}
        {!showCreateForm && !selected && (
          <div className="studio-empty">
            <p className="muted">Elegí un complemento de la lista o creá uno nuevo con «+ Nuevo».</p>
          </div>
        )}
      </div>
    </div>
  );
}
