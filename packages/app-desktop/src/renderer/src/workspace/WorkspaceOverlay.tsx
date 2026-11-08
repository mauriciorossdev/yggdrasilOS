import { useCallback, useEffect, useState } from "react";
import { Button, Modal } from "../ui/index.js";
import type { WorkspaceAsk, WorkspaceNotice } from "../types.js";
import { useI18n, type MessageKey } from "../i18n/index.js";

const NOTICE_MS = 7000;

type Toast = WorkspaceNotice & { key: number };

const MARK = "\u0001";

/** Renders a message whose named vars listed in `bold` are <strong>; the other vars are plain text. */
function rich(
  tr: (key: MessageKey, vars?: Record<string, string | number>) => string,
  key: MessageKey,
  vars: Record<string, string>,
  bold: string[],
) {
  const marked: Record<string, string> = {};
  for (const [name, value] of Object.entries(vars)) marked[name] = bold.includes(name) ? `${MARK}${name}${MARK}` : value;
  return tr(key, marked)
    .split(MARK)
    .map((part, i) => (i % 2 === 1 ? <strong key={i}>{vars[part]}</strong> : part));
}

/**
 * The two renderer-side halves of the cross-project workspace
 * (notes/features/cross-project-workspace.md): the permission prompt for an agent
 * in THIS project that wants to touch another project's pane, and a quiet toast
 * when something from another project reached a pane here on a remembered trust.
 * Mounted once per window.
 */
export function WorkspaceOverlay() {
  const { t } = useI18n();
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
          title={t("workspace.title")}
          onClose={deny}
          footer={
            <>
              <Button variant="secondary" onClick={deny}>
                {t("workspace.deny")}
              </Button>
              <Button variant="primary" onClick={() => answer(true)}>
                {t("workspace.allow")}
              </Button>
            </>
          }
        >
          {current.action === "read" ? (
            <p>
              {rich(
                t,
                "workspace.askRead",
                { from: current.fromName, action: t("workspace.verbRead"), pane: current.paneTitle, to: current.toName },
                ["from", "action", "pane", "to"],
              )}
            </p>
          ) : (
            <>
              <p>
                {rich(
                  t,
                  "workspace.askWrite",
                  { from: current.fromName, action: t("workspace.verbWrite"), pane: current.paneTitle, to: current.toName },
                  ["from", "action", "pane", "to"],
                )}
              </p>
              <p className="workspace-warning">
                {t("workspace.warning", { to: current.toName })}
              </p>
              <pre className="workspace-excerpt">{current.excerpt}</pre>
            </>
          )}
          <label className="workspace-trust">
            <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} />
            {t(current.action === "read" ? "workspace.trustRead" : "workspace.trustWrite", { to: current.toName })}
          </label>
          {asks.length > 1 && <p className="muted">{t("workspace.more", { count: asks.length - 1 })}</p>}
        </Modal>
      )}
      {toasts.length > 0 && (
        <div className="workspace-toasts" role="status">
          {toasts.map((toast) => (
            <div key={toast.key} className="workspace-toast">
              {rich(t, toast.action === "read" ? "workspace.toastRead" : "workspace.toastWrite", { from: toast.fromName, pane: toast.paneTitle }, ["from"])}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
