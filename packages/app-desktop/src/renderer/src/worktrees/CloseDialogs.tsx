import { useEffect, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";
import { Modal } from "../ui/Modal.js";
import { useI18n } from "../i18n/index.js";
import type { CommitInfo, RemoteInfo, RepoStatus, WorktreeInfo } from "../repository/types.js";
import { confirmsName, defaultPrBody, defaultPrTitle } from "./actions.js";
import { cleanGatewayError } from "./create.js";

type Common = {
  /** `repo` param of the git.* methods: the repository's main checkout. */
  repo: string;
  worktree: WorktreeInfo;
  onClose: () => void;
  /** The worktree list changed (merged, removed, pushed): refresh it. */
  onDone: () => void;
};

const messageOf = (err: unknown): string => cleanGatewayError(err instanceof Error ? err.message : String(err));

/** The folder name, which is what the user types to confirm a discard. */
export function worktreeFolder(w: WorktreeInfo): string {
  return w.path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? w.path;
}

function openLink(url: string): void {
  if (/^https:\/\//.test(url)) window.open(url, "_blank", "noopener");
}

/**
 * Merges the worktree's branch into the main checkout's branch (a plain `git merge`, done there),
 * then optionally removes the worktree and the now-merged branch. A conflict is reported, not
 * resolved: the user finishes it in the main checkout or aborts here.
 */
export function MergeDialog({
  repo,
  worktree,
  base,
  canCleanup,
  onClose,
  onDone,
}: Common & { base: string; canCleanup: boolean }) {
  const { call } = useGateway();
  const { t } = useI18n();
  const [mainChanges, setMainChanges] = useState(0);
  const [cleanup, setCleanup] = useState(canCleanup);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const branch = worktree.branch ?? "";

  useEffect(() => {
    call<RepoStatus>("git.status2", { repo })
      .then((st) => setMainChanges(st.changes.length))
      .catch(() => undefined);
  }, [call, repo]);

  const merge = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await call<{ ok: boolean; conflicts: boolean; output?: string }>("git.merge", { repo, branch });
      if (res.conflicts) {
        setConflict(res.output ?? "");
        onDone();
        return;
      }
      let note = t("wt.merge.merged", { branch, base });
      if (cleanup) {
        const removed = await call<{ branchDeleted: boolean; branchError?: string }>("git.worktreeRemove", {
          repo,
          path: worktree.path,
          deleteBranch: true,
        });
        note += removed.branchDeleted
          ? t("wt.merge.cleanedAll")
          : t("wt.merge.cleanedKept", { reason: removed.branchError ?? t("wt.merge.branchDeleteFailed") });
      }
      setResult(note);
      onDone();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const abort = async () => {
    setBusy(true);
    try {
      await call("git.merge", { repo, abort: true });
      setConflict(null);
      setError(t("wt.merge.aborted"));
      onDone();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const finished = result !== null || conflict !== null;
  return (
    <Modal
      title={t("wt.merge.title", { base })}
      onClose={busy ? () => undefined : onClose}
      footer={
        finished ? (
          <>
            {conflict !== null && (
              <button type="button" className="repo-btn" onClick={() => void abort()} disabled={busy}>
                {t("wt.merge.abort")}
              </button>
            )}
            <button type="button" className="repo-btn primary" onClick={onClose} disabled={busy}>
              {conflict !== null ? t("wt.merge.resolveMyself") : t("wt.common.close")}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="repo-btn" onClick={onClose} disabled={busy}>
              {t("wt.common.cancel")}
            </button>
            <button type="button" className="repo-btn primary" onClick={() => void merge()} disabled={busy}>
              {busy ? t("wt.merge.merging") : t("wt.merge.merge")}
            </button>
          </>
        )
      }
    >
      <div className="wt-form">
        {result !== null ? (
          <p>{result}</p>
        ) : conflict !== null ? (
          <>
            <div className="repo-banner error">{t("wt.merge.conflictBanner")}</div>
            <pre className="wt-output">{conflict.trim()}</pre>
            <p className="repo-muted">
              {t("wt.merge.conflictHint")}
            </p>
          </>
        ) : (
          <>
            <p>
              {t("wt.merge.introPre")}<code>git merge {branch}</code>{t("wt.merge.introMid")}<code>{base}</code>{t("wt.merge.introPost")}
            </p>
            {mainChanges > 0 && (
              <div className="repo-banner warn">
                {t(mainChanges === 1 ? "wt.merge.mainChangesOne" : "wt.merge.mainChangesMany", { count: mainChanges })}
              </div>
            )}
            <label className="wt-check">
              <input type="checkbox" checked={cleanup} disabled={!canCleanup} onChange={(e) => setCleanup(e.target.checked)} />
              {t("wt.merge.cleanup")}
            </label>
            {!canCleanup && <p className="repo-muted">{t("wt.merge.agentHere")}</p>}
          </>
        )}
        {error && <div className="repo-banner error">{error}</div>}
      </div>
    </Modal>
  );
}

/**
 * Publishes the branch to its remote and opens a pull request with the GitHub CLI. Both steps are
 * announced up front and only run on this dialog's confirm: the app never pushes on its own.
 */
export function PullRequestDialog({
  repo,
  commitsRepo,
  worktree,
  base,
  onClose,
  onDone,
}: Common & {
  base: string;
  /** `repo` param of the worktree itself (null when it is outside the project): where the branch's commits are read. */
  commitsRepo: string | null;
}) {
  const { call } = useGateway();
  const { t } = useI18n();
  const branch = worktree.branch ?? "";
  const [remotes, setRemotes] = useState<RemoteInfo[] | null>(null);
  const [title, setTitle] = useState(defaultPrTitle(branch, []));
  const [body, setBody] = useState("");
  const [edited, setEdited] = useState(false);

  // Suggest the title and description from the branch's commits, unless the user already typed.
  useEffect(() => {
    if (commitsRepo === null || edited) return;
    call<{ commits: CommitInfo[] }>("git.log", { repo: commitsRepo, ref: `${base}..HEAD`, limit: 30 })
      .then((res) => {
        const subjects = res.commits.map((c) => c.subject);
        setTitle(defaultPrTitle(branch, subjects));
        setBody(defaultPrBody(subjects));
      })
      .catch(() => undefined);
  }, [call, commitsRepo, base, branch, edited]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pushed, setPushed] = useState(false);
  const [outcome, setOutcome] = useState<{ url?: string; note: string } | null>(null);

  useEffect(() => {
    call<{ remotes: RemoteInfo[] }>("git.remotes", { repo })
      .then((res) => setRemotes(res.remotes))
      .catch(() => setRemotes([]));
  }, [call, repo]);

  const remote = remotes?.find((r) => r.name === "origin") ?? remotes?.[0];

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!pushed) {
        await call("git.push", { repo, branch });
        setPushed(true);
        onDone();
      }
      const res = await call<{ created: boolean; reason?: string; url?: string; compareUrl?: string }>("git.pullRequest", {
        repo,
        branch,
        base,
        title,
        body,
      });
      if (res.created) setOutcome({ url: res.url, note: t("wt.pr.created") });
      else if (res.reason === "exists") setOutcome({ url: res.url, note: t("wt.pr.exists") });
      else
        setOutcome({
          url: res.compareUrl,
          note: t("wt.pr.noGh"),
        });
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t("wt.pr.title")}
      onClose={busy ? () => undefined : onClose}
      footer={
        outcome ? (
          <>
            {outcome.url && (
              <button type="button" className="repo-btn" onClick={() => openLink(outcome.url!)}>
                {t("wt.pr.openBrowser")}
              </button>
            )}
            <button type="button" className="repo-btn primary" onClick={onClose}>
              {t("wt.common.close")}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="repo-btn" onClick={onClose} disabled={busy}>
              {t("wt.common.cancel")}
            </button>
            <button
              type="button"
              className="repo-btn primary"
              onClick={() => void submit()}
              disabled={busy || !remote || title.trim() === ""}
            >
              {busy ? t("wt.pr.publishing") : pushed ? t("wt.pr.retry") : t("wt.pr.title")}
            </button>
          </>
        )
      }
    >
      <div className="wt-form">
        {outcome ? (
          <>
            <p>{outcome.note}</p>
            {outcome.url && <code className="wt-url">{outcome.url}</code>}
          </>
        ) : (
          <>
            <p>
              {t("wt.pr.p1")}<code>git push</code>{t("wt.pr.p2")}<code>{branch}</code>{t("wt.pr.p3")}
              <code>{remote ? `${remote.name}` : "…"}</code>{t("wt.pr.p4")}<code>{base}</code>{t("wt.pr.p5")}
              <code>gh</code>{t("wt.pr.p6")}
            </p>
            {remotes !== null && !remote && (
              <div className="repo-banner error">{t("wt.pr.noRemote")}</div>
            )}
            {remote && <div className="wt-detail-meta">{remote.url}</div>}
            <label>
              {t("wt.pr.titleLabel")}
              <input className="repo-input" value={title} onChange={(e) => {
                  setEdited(true);
                  setTitle(e.target.value);
                }} autoFocus />
            </label>
            <label>
              {t("wt.pr.bodyLabel")}
              <textarea className="repo-input" rows={6} value={body} onChange={(e) => {
                  setEdited(true);
                  setBody(e.target.value);
                }} />
            </label>
            {pushed && <div className="repo-banner info">{t("wt.pr.alreadyPushed")}</div>}
          </>
        )}
        {error && <div className="repo-banner error">{error}</div>}
      </div>
    </Modal>
  );
}

/**
 * Throws a worktree away together with its branch and anything not merged. Unlocks only when the
 * folder name is typed, and spells out what is lost.
 */
export function DiscardDialog({ repo, worktree, onClose, onDone }: Common) {
  const { call } = useGateway();
  const { t } = useI18n();
  const name = worktreeFolder(worktree);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const discard = async () => {
    setBusy(true);
    setError(null);
    try {
      await call("git.worktreeRemove", { repo, path: worktree.path, force: true, deleteBranch: true });
      onDone();
      onClose();
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  };

  const losses = [
    worktree.ahead > 0 ? t(worktree.ahead === 1 ? "wt.discard.lossAheadOne" : "wt.discard.lossAheadMany", { count: worktree.ahead }) : null,
    worktree.changes > 0
      ? t(worktree.changes === 1 ? "wt.discard.lossChangesOne" : "wt.discard.lossChangesMany", { count: worktree.changes })
      : null,
  ].filter(Boolean);

  return (
    <Modal
      title={t("wt.discard.title")}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button type="button" className="repo-btn" onClick={onClose} disabled={busy}>
            {t("wt.common.cancel")}
          </button>
          <button
            type="button"
            className="repo-btn danger"
            onClick={() => void discard()}
            disabled={busy || !confirmsName(typed, name)}
          >
            {busy ? t("wt.discard.discarding") : t("wt.discard.discard")}
          </button>
        </>
      }
    >
      <div className="wt-form">
        <p>
          {t("wt.discard.folderPre")}<code>{name}</code>
          {worktree.branch ? (
            <>
              {t("wt.discard.andBranch")}<code>{worktree.branch}</code>
            </>
          ) : null}
          {t("wt.discard.folderPost")}
        </p>
        {losses.length > 0 ? (
          <div className="repo-banner error">{t("wt.discard.willLose", { list: losses.join(t("wt.discard.lossJoin")) })}</div>
        ) : (
          <p className="repo-muted">{t("wt.discard.noWork")}</p>
        )}
        <label>
          <span>
            {t("wt.discard.typePre")}<code>{name}</code>{t("wt.discard.typePost")}
          </span>
          <input className="repo-input" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
        </label>
        {error && <div className="repo-banner error">{error}</div>}
      </div>
    </Modal>
  );
}
