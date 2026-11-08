import { useCallback, useEffect, useState } from "react";
import { Button, Chip } from "../../ui/index.js";
import { useI18n, type MessageKey } from "../../i18n/index.js";
import type { WorkspaceView } from "../../types.js";

const ACTION_LABEL = { read: "set.workspace.read", write: "set.workspace.write" } as const satisfies Record<string, MessageKey>;
const VIA_LABEL = {
  ask: "set.workspace.viaAsk",
  trust: "set.workspace.viaTrust",
  denied: "set.workspace.viaDenied",
} as const satisfies Record<string, MessageKey>;

/**
 * Settings -> Workspace: which other projects this project's agents may ask to
 * reach, the trusts the user granted from the prompt (revocable), and the log of
 * cross-project reads/writes. A link alone grants nothing: every read/write still
 * asks unless the user ticked "trust" on that prompt.
 */
export function WorkspaceSection() {
  const { t: tr } = useI18n();
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
      <h3>{tr("set.workspace.title")}</h3>
      <p className="muted">
        {tr("set.workspace.intro")}
      </p>
      {error && <p className="error">{error}</p>}

      <h4>{tr("set.workspace.linked")}</h4>
      {view && view.projects.length === 0 && <p className="muted">{tr("set.workspace.noProjects")}</p>}
      <ul className="workspace-list">
        {view?.projects.map((p) => (
          <li key={p.id}>
            <label className="settings-check">
              <input type="checkbox" checked={p.linked} onChange={(e) => void toggleLink(p.id, e.target.checked)} />
              {p.name}
            </label>
            <Chip tone={p.open ? "ready" : "neutral"}>{p.open ? tr("set.workspace.open") : tr("set.workspace.closed")}</Chip>
          </li>
        ))}
      </ul>

      <h4>{tr("set.workspace.trusts")}</h4>
      {view && view.trust.length === 0 && <p className="muted">{tr("set.workspace.noTrusts")}</p>}
      <ul className="workspace-list">
        {view?.trust.map((t) => (
          <li key={t.key}>
            <span>
              {tr(ACTION_LABEL[t.action])} {tr("set.workspace.panesOf")} <strong>{t.toName}</strong> {tr("set.workspace.withoutAsking")}
            </span>
            <Button size="sm" variant="secondary" onClick={() => void revoke(t.key)}>
              {tr("set.workspace.remove")}
            </Button>
          </li>
        ))}
      </ul>

      <h4>{tr("set.workspace.log")}</h4>
      {view && view.audit.length === 0 && <p className="muted">{tr("set.workspace.noActivity")}</p>}
      <ul className="workspace-list workspace-audit">
        {view?.audit.map((e) => (
          <li key={`${e.at}-${e.from}-${e.to}-${e.pane}-${e.action}`}>
            <span>
              {new Date(e.at).toLocaleString()} · <strong>{e.from}</strong> → <strong>{e.to}</strong> ({e.pane}) ·{" "}
              {tr(ACTION_LABEL[e.action])}
            </span>
            <Chip tone={e.via === "denied" ? "danger" : "neutral"}>{tr(VIA_LABEL[e.via])}</Chip>
          </li>
        ))}
      </ul>
      <Button size="sm" variant="ghost" onClick={refresh}>
        {tr("set.workspace.refresh")}
      </Button>
    </section>
  );
}
