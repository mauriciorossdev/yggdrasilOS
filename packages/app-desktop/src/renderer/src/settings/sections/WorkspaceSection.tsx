import { useCallback, useEffect, useState } from "react";
import { Button, Chip } from "../../ui/index.js";
import type { WorkspaceView } from "../../types.js";

const ACTION_LABEL = { read: "leer", write: "escribir" } as const;
const VIA_LABEL = { ask: "aprobado", trust: "por confianza", denied: "denegado" } as const;

/**
 * Settings -> Workspace: which other projects this project's agents may ask to
 * reach, the trusts the user granted from the prompt (revocable), and the log of
 * cross-project reads/writes. A link alone grants nothing: every read/write still
 * asks unless the user ticked "trust" on that prompt.
 */
export function WorkspaceSection() {
  const [view, setView] = useState<WorkspaceView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    window.yggdrasil.workspace
      .view()
      .then(setView)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(refresh, [refresh]);

  const toggleLink = async (targetId: string, linked: boolean) => {
    await window.yggdrasil.workspace.setLink(targetId, linked);
    refresh();
  };

  const revoke = async (key: string) => {
    await window.yggdrasil.workspace.revokeTrust(key);
    refresh();
  };

  return (
    <section className="settings-section">
      <h3>Workspace</h3>
      <p className="muted">
        Deja que los agentes de este proyecto lean, o escriban en, los panes de otros proyectos abiertos en este equipo.
        Vincular un proyecto no concede nada: cada lectura o escritura te pregunta, salvo que marques «confiar» en la
        pregunta. El vínculo es de este proyecto hacia el otro (el otro no puede alcanzar a este por eso).
      </p>
      {error && <p className="error">{error}</p>}

      <h4>Proyectos vinculados</h4>
      {view && view.projects.length === 0 && <p className="muted">No hay otros proyectos registrados.</p>}
      <ul className="workspace-list">
        {view?.projects.map((p) => (
          <li key={p.id}>
            <label>
              <input type="checkbox" checked={p.linked} onChange={(e) => void toggleLink(p.id, e.target.checked)} />
              {p.name}
            </label>
            <Chip tone={p.open ? "ready" : "neutral"}>{p.open ? "abierto" : "cerrado"}</Chip>
          </li>
        ))}
      </ul>

      <h4>Confianzas concedidas</h4>
      {view && view.trust.length === 0 && <p className="muted">Ninguna: se pregunta cada vez.</p>}
      <ul className="workspace-list">
        {view?.trust.map((t) => (
          <li key={t.key}>
            <span>
              {ACTION_LABEL[t.action]} panes de <strong>{t.toName}</strong> sin preguntar
            </span>
            <Button size="sm" variant="secondary" onClick={() => void revoke(t.key)}>
              Quitar
            </Button>
          </li>
        ))}
      </ul>

      <h4>Registro</h4>
      {view && view.audit.length === 0 && <p className="muted">Sin actividad entre proyectos todavía.</p>}
      <ul className="workspace-list workspace-audit">
        {view?.audit.map((e) => (
          <li key={`${e.at}-${e.from}-${e.to}-${e.pane}-${e.action}`}>
            <span>
              {new Date(e.at).toLocaleString()} · <strong>{e.from}</strong> → <strong>{e.to}</strong> ({e.pane}) ·{" "}
              {ACTION_LABEL[e.action]}
            </span>
            <Chip tone={e.via === "denied" ? "danger" : "neutral"}>{VIA_LABEL[e.via]}</Chip>
          </li>
        ))}
      </ul>
      <Button size="sm" variant="ghost" onClick={refresh}>
        Actualizar
      </Button>
    </section>
  );
}
