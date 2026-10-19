import { useState } from "react";
import { StudioChatPane } from "./StudioChatPane.js";
import { StudioPreview } from "./StudioPreview.js";
import { StudioTerminalPane } from "./StudioTerminalPane.js";
import type { StudioTerminalHarness } from "./studioContext.js";
import type { PluginRecord } from "../types.js";

type AuthoringMode = "terminal" | "chat";

type Props = {
  plugin: PluginRecord;
  projectPath: string;
  /** Fires right after a successful delete, before the folder-gone re-scan lands — lets StudioView clear its selection immediately instead of briefly pointing at a plugin that no longer exists on disk. */
  onDeleted: () => void;
};

/**
 * Per-selection chrome: header (name/status/scope, Terminal/Chat toggle,
 * Publicar/Eliminar) plus a split body — the chosen authoring pane on the
 * left and the live `StudioPreview` on the right. Switching modes unmounts
 * the previous authoring pane, which is exactly what disposes
 * `StudioTerminalPane`'s live pty (see its own doc comment).
 */
export function StudioWorkspace({ plugin, projectPath, onDeleted }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<AuthoringMode>("terminal");
  const [harness, setHarness] = useState<StudioTerminalHarness>("claude");
  const isDraft = plugin.manifest.status === "draft";

  const publish = async () => {
    setBusy(true);
    setError(null);
    try {
      await window.yggdrasil.plugins.setStatus(plugin.scope, plugin.manifest.id, "published");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (
      !window.confirm(
        `¿Eliminar el complemento "${plugin.manifest.name}"? Esto borra su carpeta por completo — no se puede deshacer.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await window.yggdrasil.plugins.delete(plugin.scope, plugin.manifest.id);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="studio-workspace">
      <div className="studio-workspace-header">
        <div className="studio-workspace-title">
          <span className="plugin-icon">
            {plugin.manifest.icon && !plugin.manifest.icon.includes(".") ? plugin.manifest.icon : "🧩"}
          </span>
          <span>{plugin.manifest.name}</span>
          <span className={`scope-tag${isDraft ? " plugin-draft-tag" : ""}`}>
            {isDraft ? "borrador" : "publicado"}
          </span>
          {plugin.scope === "global" && <span className="scope-tag">global</span>}
        </div>
        <div className="studio-mode-toggle">
          <button
            type="button"
            className={mode === "terminal" ? "active" : ""}
            onClick={() => setMode("terminal")}
          >
            Terminal
          </button>
          <button type="button" className={mode === "chat" ? "active" : ""} onClick={() => setMode("chat")}>
            Chat
          </button>
        </div>
        {mode === "terminal" && (
          <select
            className="studio-harness-select"
            value={harness}
            onChange={(e) => setHarness(e.target.value as StudioTerminalHarness)}
            title="Elegí qué CLI corre en esta terminal"
          >
            <option value="claude">claude</option>
            <option value="agy">agy (Antigravity)</option>
          </select>
        )}
        <div className="studio-workspace-actions">
          {isDraft && (
            <button type="button" onClick={() => void publish()} disabled={busy}>
              Publicar
            </button>
          )}
          <button type="button" className="studio-danger-btn" onClick={() => void remove()} disabled={busy}>
            Eliminar
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="studio-workspace-body">
        <div className="studio-authoring-pane">
          {mode === "terminal" ? (
            <StudioTerminalPane plugin={plugin} projectPath={projectPath} harness={harness} />
          ) : (
            <StudioChatPane plugin={plugin} />
          )}
        </div>
        <StudioPreview plugin={plugin} />
      </div>
    </div>
  );
}
