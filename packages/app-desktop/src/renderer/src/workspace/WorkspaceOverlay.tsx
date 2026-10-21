import { useCallback, useEffect, useState } from "react";
import { Button, Modal } from "../ui/index.js";
import type { WorkspaceAsk, WorkspaceNotice } from "../types.js";

const NOTICE_MS = 7000;

type Toast = WorkspaceNotice & { key: number };

/**
 * The two renderer-side halves of the cross-project workspace
 * (notes/features/cross-project-workspace.md): the permission prompt for an agent
 * in THIS project that wants to touch another project's pane, and a quiet toast
 * when something from another project reached a pane here on a remembered trust.
 * Mounted once per window.
 */
export function WorkspaceOverlay() {
  const [asks, setAsks] = useState<WorkspaceAsk[]>([]);
  const [trust, setTrust] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => window.yggdrasil.workspace.onAsk((ask) => setAsks((prev) => [...prev, ask])), []);
  useEffect(
    () => window.yggdrasil.workspace.onAskClosed(({ id }) => setAsks((prev) => prev.filter((a) => a.id !== id))),
    [],
  );
  useEffect(
    () =>
      window.yggdrasil.workspace.onNotice((notice) => {
        const key = Date.now() + Math.random();
        setToasts((prev) => [...prev, { ...notice, key }]);
        setTimeout(() => setToasts((prev) => prev.filter((t) => t.key !== key)), NOTICE_MS);
      }),
    [],
  );

  const current = asks[0];

  const answer = useCallback(
    (allow: boolean) => {
      if (!current) return;
      void window.yggdrasil.workspace.answer(current.id, { allow, trust: allow && trust });
      setAsks((prev) => prev.slice(1));
      setTrust(false);
    },
    [current, trust],
  );

  const deny = useCallback(() => answer(false), [answer]);

  return (
    <>
      {current && (
        <Modal
          title="Otro proyecto"
          onClose={deny}
          footer={
            <>
              <Button variant="secondary" onClick={deny}>
                Denegar
              </Button>
              <Button variant="primary" onClick={() => answer(true)}>
                Permitir
              </Button>
            </>
          }
        >
          {current.action === "read" ? (
            <p>
              Un agente de <strong>{current.fromName}</strong> quiere <strong>leer</strong> el pane{" "}
              <strong>{current.paneTitle}</strong> de <strong>{current.toName}</strong>.
            </p>
          ) : (
            <>
              <p>
                Un agente de <strong>{current.fromName}</strong> quiere <strong>escribir</strong> en el pane{" "}
                <strong>{current.paneTitle}</strong> de <strong>{current.toName}</strong>.
              </p>
              <p className="workspace-warning">
                El agente de {current.toName} recibirá este texto como una instrucción de otro proyecto:
              </p>
              <pre className="workspace-excerpt">{current.excerpt}</pre>
            </>
          )}
          <label className="workspace-trust">
            <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} />
            Confiar y no volver a preguntar para {current.action === "read" ? "leer" : "escribir en"} panes de{" "}
            {current.toName}
          </label>
          {asks.length > 1 && <p className="muted">{asks.length - 1} más en espera</p>}
        </Modal>
      )}
      {toasts.length > 0 && (
        <div className="workspace-toasts" role="status">
          {toasts.map((t) => (
            <div key={t.key} className="workspace-toast">
              {t.action === "read" ? "Leído" : "Recibido"} de <strong>{t.fromName}</strong> (pane {t.paneTitle})
            </div>
          ))}
        </div>
      )}
    </>
  );
}
