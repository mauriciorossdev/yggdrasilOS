import { useEffect, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";
import { Modal } from "@yggdrasil/ui-kit";
import { useI18n } from "../i18n/index.js";
import { requestOpenRepo } from "../repository/openRepoRequest.js";
import { requestClosePanes } from "../terminal/terminalPanesStore.js";
import { setActiveTab } from "../ui/mainTabsStore.js";
import { baseChanges, runBulkMerge, runBulkRemove, type BulkItem, type Step } from "./bulk.js";

const CLOSE_WAIT_MS = 6000;
const CLOSE_POLL_MS = 200;

/** Closes the panes and waits until their processes are gone: git refuses to remove a worktree a live Claude holds. */
async function closePanesAndWait(ids: string[]): Promise<void> {
  requestClosePanes(ids);
  const start = Date.now();
  while (Date.now() - start < CLOSE_WAIT_MS) {
    const alive = await Promise.all(ids.map((id) => window.yggdrasil.terminals.read(id, 1)));
    if (alive.every((out) => out === undefined)) break;
    await new Promise((r) => setTimeout(r, CLOSE_POLL_MS));
  }
  // The pty is gone; give the agent's own process a moment to exit and drop its worktree lock.
  await new Promise((r) => setTimeout(r, 400));
}

type Props = {
  kind: "merge" | "remove";
  /** git.* `repo` param of the main checkout. */
  repo: string;
  base: string;
  items: BulkItem[];
  /** Project-relative repo param of a worktree, to open one with a conflict in Repositorio. */
  repoParamOf: (path: string) => string | null;
  onClose: () => void;
  onDone: () => void;
};

/**
 * Merge or remove several worktrees at once: options, then one row per
 * worktree as it goes, then a summary. A conflict is aborted and left for the
 * user; nothing is forced. See notes/features/worktree-bulk-actions.md.
 */
export function BulkDialog({ kind, repo, base, items, repoParamOf, onClose, onDone }: Props) {
  const { call } = useGateway();
  const { t } = useI18n();
  const anyPanes = items.some((i) => i.paneIds.length > 0);
  const [removeAfter, setRemoveAfter] = useState(true);
  const [closePanes, setClosePanes] = useState(true);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [running, setRunning] = useState(false);
  const [blocked, setBlocked] = useState<number | null>(null);

  // A batch of merges on top of uncommitted changes in the base is refused before it starts.
  useEffect(() => {
    if (kind !== "merge") return;
    baseChanges(call, repo)
      .then((n) => setBlocked(n > 0 ? n : null))
      .catch(() => setBlocked(null));
  }, [call, kind, repo]);

  const start = async () => {
    setRunning(true);
    const deps = {
      call,
      repo,
      closePanes: closePanesAndWait,
      dropComments: (path: string) => window.yggdrasil.codeComments.dropRoot(path),
      onStep: setSteps,
    };
    try {
      if (kind === "merge") await runBulkMerge(deps, items, { removeAfter, closePanes: removeAfter && closePanes });
      else await runBulkRemove(deps, items, { closePanes });
    } finally {
      setRunning(false);
      onDone();
    }
  };

  const finished = steps !== null && !running;
  const count = (states: Step["state"][]) => steps?.filter((s) => states.includes(s.state)).length ?? 0;
  const title =
    kind === "merge"
      ? t(items.length === 1 ? "wt.bulk.mergeTitleOne" : "wt.bulk.mergeTitle", { count: items.length, base })
      : t(items.length === 1 ? "wt.bulk.removeTitleOne" : "wt.bulk.removeTitle", { count: items.length });

  return (
    <Modal
      title={finished ? t("wt.bulk.doneTitle") : title}
      onClose={running ? () => undefined : onClose}
      footer={
        steps === null ? (
          <>
            <button type="button" className="repo-btn" onClick={onClose}>
              {t("wt.common.cancel")}
            </button>
            <button
              type="button"
              className={`repo-btn ${kind === "merge" ? "primary" : "danger"}`}
              disabled={blocked !== null}
              onClick={() => void start()}
            >
              {kind === "merge" ? t("wt.bulk.merge", { count: items.length, base }) : t("wt.bulk.remove", { count: items.length })}
            </button>
          </>
        ) : (
          <button type="button" className="repo-btn primary" disabled={running} onClick={onClose}>
            {t("wt.common.close")}
          </button>
        )
      }
    >
      <div className="wt-form">
        {steps === null && (
          <>
            {blocked !== null && <div className="repo-banner error">{t("wt.bulk.baseDirty", { base, count: blocked })}</div>}
            {kind === "remove" && <p>{t("wt.bulk.removeIntro")}</p>}
            {kind === "merge" && (
              <label className="settings-check">
                <input type="checkbox" checked={removeAfter} onChange={(e) => setRemoveAfter(e.target.checked)} />
                {t("wt.bulk.removeAfter")}
              </label>
            )}
            {anyPanes && (kind === "remove" || removeAfter) && (
              <label className="settings-check">
                <input type="checkbox" checked={closePanes} onChange={(e) => setClosePanes(e.target.checked)} />
                {t("wt.bulk.closePanes")}
              </label>
            )}
          </>
        )}

        {finished && (
          <div className="wt-bulk-summary">
            {kind === "merge" ? (
              <>
                <span className="ok">{t("wt.bulk.sumMerged", { count: count(["merged", "removed"]) })}</span>
                <span className="bad">{t("wt.bulk.sumConflict", { count: count(["conflict"]) })}</span>
              </>
            ) : (
              <span className="ok">{t("wt.bulk.sumRemoved", { count: count(["removed"]) })}</span>
            )}
            <span className="none">{t("wt.bulk.sumError", { count: count(["error"]) })}</span>
          </div>
        )}

        <div className="wt-bulk-steps">
          {(steps ?? items.map((i): Step => ({ path: i.worktree.path, name: i.name, state: "pending" }))).map((s) => (
            <div key={s.path} className={`wt-bulk-step ${s.state}`}>
              <span className="wt-bulk-icon" aria-hidden>
                {s.state === "running" ? "◌" : s.state === "conflict" ? "!" : s.state === "error" ? "✕" : s.state === "pending" ? "·" : "✓"}
              </span>
              <span className="wt-bulk-name">{s.name}</span>
              <span className="wt-bulk-state">{t(`wt.bulk.state.${s.state}`)}</span>
              {s.state === "conflict" && (
                <span className="wt-bulk-why">
                  {t("wt.bulk.conflictNote")}
                  {repoParamOf(s.path) !== null && (
                    <button
                      type="button"
                      className="repo-btn small"
                      onClick={() => {
                        requestOpenRepo(repoParamOf(s.path)!, s.name);
                        setActiveTab("repository");
                        onClose();
                      }}
                    >
                      {t("wt.bulk.openInRepo")}
                    </button>
                  )}
                </span>
              )}
              {s.detail && <pre className="wt-output wt-bulk-detail">{s.detail}</pre>}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
