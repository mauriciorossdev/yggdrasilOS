import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownIcon, ArrowDownTrayIcon, ArrowPathIcon, ArrowUpIcon } from "@heroicons/react/20/solid";
import { BranchesPanel } from "./BranchesPanel.js";
import { ChangesPanel } from "./ChangesPanel.js";
import { CommitLog } from "./CommitLog.js";
import { DiffViewer } from "./DiffViewer.js";
import { RepoSelector } from "./RepoSelector.js";
import { splitPath } from "./format.js";
import { useRepo } from "./useRepo.js";
import type { CommitDetail, DiffContent, DiffSelection, GitChange } from "./types.js";
import { useI18n } from "../i18n/index.js";

const DIFF_LAYOUT_KEY = "ygg.repo.diffLayout";

function readDiffLayout(): "unified" | "split" {
  try {
    return localStorage.getItem(DIFF_LAYOUT_KEY) === "split" ? "split" : "unified";
  } catch {
    return "unified";
  }
}

/**
 * "Repositorio" main tab — a small git client (branches, changes, history,
 * diffs, stash, push/pull). Backed by the gateway's git.* methods
 * (packages/gateway/src/git-methods.ts), which are a direct user action: no
 * approval round trip. A project may hold zero, one or several repositories
 * (root, a parent of the root, or nested subfolders) — RepoSelector says which.
 */
export function RepositoryView() {
  const { t } = useI18n();
  const r = useRepo();
  const { call, repo, status, run } = r;
  const [tab, setTab] = useState<"changes" | "history">("changes");
  const [selection, setSelection] = useState<DiffSelection | null>(null);
  const [diff, setDiff] = useState<DiffContent | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffLayout, setDiffLayout] = useState<"unified" | "split">(readDiffLayout);
  const chooseDiffLayout = (next: "unified" | "split") => {
    setDiffLayout(next);
    try {
      localStorage.setItem(DIFF_LAYOUT_KEY, next);
    } catch {
      // storage unavailable — choice just won't persist
    }
  };
  const [commitSha, setCommitSha] = useState<string | null>(null);
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const lastCheckout = useRef<{ branch: string; remote: boolean } | null>(null);

  // Selection belongs to one repo.
  useEffect(() => {
    setSelection(null);
    setDiff(null);
    setCommitSha(null);
    setDetail(null);
  }, [repo]);

  // Re-fetch the diff when the selection changes or the repo state refreshed
  // (staging a file, editing it...). Keeps the previous content on screen
  // while the new one loads, so there's no flicker on every refresh.
  const { version } = r;
  useEffect(() => {
    if (!selection || repo === null) return;
    let cancelled = false;
    setDiffLoading(true);
    const params =
      selection.kind === "change"
        ? { repo, path: selection.path, mode: selection.mode }
        : { repo, path: selection.path, mode: "commit", sha: selection.sha, origPath: selection.origPath };
    call<DiffContent>("git.diff2", params)
      .then((res) => !cancelled && setDiff(res))
      .catch(() => !cancelled && setDiff(null))
      .finally(() => !cancelled && setDiffLoading(false));
    return () => {
      cancelled = true;
    };
  }, [selection, repo, call, version]);

  useEffect(() => {
    if (!commitSha || repo === null) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    call<CommitDetail>("git.show", { repo, sha: commitSha })
      .then((res) => !cancelled && setDetail(res))
      .catch(() => !cancelled && setDetail(null));
    return () => {
      cancelled = true;
    };
  }, [commitSha, repo, call]);

  const disabled = r.busy !== null;

  const checkout = useCallback(
    async (name: string, remote: boolean) => {
      let target = name;
      let isRemote = remote;
      if (remote) {
        // "origin/feat" → if a local "feat" already exists just switch to it.
        const local = name.slice(name.indexOf("/") + 1);
        if (r.branches.some((b) => !b.remote && b.name === local)) {
          target = local;
          isRemote = false;
        }
      }
      lastCheckout.current = { branch: target, remote: isRemote };
      await run("git.checkout", { branch: target, remote: isRemote }, t("repo.view.switching"));
    },
    [run, r.branches, t],
  );

  const stashAndRetryCheckout = useCallback(async () => {
    const last = lastCheckout.current;
    if (!last) return;
    const saved = await run("git.stashSave", { includeUntracked: true, message: t("repo.view.autoStash", { branch: last.branch }) });
    if (saved) await run("git.checkout", last, t("repo.view.switching"));
  }, [run, t]);

  const deleteBranch = useCallback(
    async (name: string) => {
      if (!window.confirm(t("repo.view.confirmDelete", { name }))) return;
      await run("git.branchDelete", { branch: name }, t("repo.view.deleting"));
    },
    [run, t],
  );

  // Retry a failed soft delete as force once the user explicitly agrees.
  useEffect(() => {
    if (r.error?.method === "git.branchDelete" && /not fully merged/i.test(r.error.message)) {
      const m = /branch '([^']+)'/.exec(r.error.message);
      if (m && window.confirm(t("repo.view.confirmForceDelete", { name: m[1] ?? "" }))) {
        void run("git.branchDelete", { branch: m[1], force: true }, t("repo.view.deleting"));
      } else {
        r.clearError();
      }
    }
  }, [r.error]); // eslint-disable-line react-hooks/exhaustive-deps

  const merge = useCallback(
    async (name: string) => {
      if (!window.confirm(t("repo.view.confirmMerge", { name, target: status?.branch ?? t("repo.view.currentBranch") }))) return;
      const res = await run<{ ok: boolean; conflicts?: boolean }>("git.merge", { branch: name }, t("repo.view.merging"));
      if (res?.conflicts) setTab("changes");
    },
    [run, status?.branch, t],
  );

  const discard = useCallback(
    async (c: GitChange) => {
      const untracked = c.kind === "untracked";
      const msg = untracked
        ? t("repo.view.confirmDiscardUntracked", { path: c.path })
        : t("repo.view.confirmDiscard", { path: c.path });
      if (!window.confirm(msg)) return;
      await run("git.discard", untracked ? { untracked: [c.path] } : { tracked: [c.path] });
    },
    [run, t],
  );

  const commit = useCallback(
    async (message: string, amend: boolean) => {
      if (amend && !window.confirm(t("repo.view.confirmAmend"))) return false;
      return (await run("git.commit", { message, amend }, "Commit…")) !== null;
    },
    [run, t],
  );

  const push = useCallback(async () => {
    if (!status?.upstream && status?.branch) {
      await run("git.push", { setUpstream: true, branch: status.branch }, "Push…");
    } else {
      await run("git.push", {}, "Push…");
    }
  }, [run, status?.upstream, status?.branch]);

  if (r.repos === null) return <div className="repo-view"><div className="repo-empty">{t("repo.view.searching")}</div></div>;

  if (r.repos.length === 0) {
    return (
      <div className="repo-view">
        <div className="repo-empty">
          <p>{t("repo.view.noRepo")}</p>
          <button type="button" className="repo-btn primary" disabled={disabled} onClick={() => void run("git.init", {}, "git init…")}>
            {t("repo.view.initRepo")}
          </button>
          {r.error && <div className="repo-banner error">{r.error.message}</div>}
        </div>
      </div>
    );
  }

  const rootIsRepo = r.repos.some((x) => x.relation !== "child");

  return (
    <div className="repo-view">
      <div className="repo-topbar">
        <RepoSelector repos={r.repos} selected={repo} onSelect={r.setRepo} />
        {status && (
          <div className="repo-branch-pill" title={status.upstream ? t("repo.view.follows", { upstream: status.upstream }) : t("repo.view.noUpstream")}>
            <span className="repo-branch-pill-name">{status.detached ? t("repo.view.detached") : (status.branch ?? "—")}</span>
          </div>
        )}
        {status && status.ahead > 0 && (
          <span className="repo-chip ahead" title={t("repo.view.aheadTip", { count: status.ahead, remote: status.upstream ?? t("repo.view.theRemote") })}>
            ↑ {status.ahead}
          </span>
        )}
        {status && status.behind > 0 && (
          <span className="repo-chip behind" title={t("repo.view.behindTip", { count: status.behind, remote: status.upstream ?? t("repo.view.theRemote") })}>
            ↓ {status.behind}
          </span>
        )}
        <div className="repo-topbar-spacer" />
        {r.busy && <span className="repo-busy">{r.busy}</span>}
        <button type="button" className="repo-icon-btn large" disabled={disabled} onClick={() => void r.reload()} title={t("repo.view.refresh")} aria-label={t("repo.view.refresh")}>
          <ArrowPathIcon className="hero-icon" />
        </button>
        <div className="repo-actions">
          <button type="button" className="repo-btn" disabled={disabled} onClick={() => void run("git.fetch", {}, "Fetch…")}>
            <ArrowDownTrayIcon className="hero-icon" />
            Fetch
          </button>
          <button type="button" className="repo-btn" disabled={disabled} onClick={() => void run("git.pull", {}, "Pull…")} title={t("repo.view.pullTip")}>
            <ArrowDownIcon className="hero-icon" />
            Pull
          </button>
          <button
            type="button"
            className={`repo-btn${status && (status.ahead > 0 || !status.upstream) ? " primary" : ""}`}
            disabled={disabled || !status?.branch}
            onClick={() => void push()}
          >
            <ArrowUpIcon className="hero-icon" />
            {status && status.ahead > 0 ? t(status.ahead === 1 ? "repo.view.pushOne" : "repo.view.pushMany", { count: status.ahead }) : "Push"}
          </button>
        </div>
      </div>

      {!rootIsRepo && (
        <div className="repo-banner info">
          {t("repo.view.notRootRepo", { count: r.repos.length })}
        </div>
      )}

      {r.error && (
        <div className="repo-banner error">
          <pre className="repo-error-text">{r.error.message}</pre>
          {r.error.method === "git.checkout" && lastCheckout.current && /overwritten|local changes|would be/i.test(r.error.message) && (
            <button type="button" className="repo-btn small" disabled={disabled} onClick={() => void stashAndRetryCheckout()}>
              {t("repo.view.stashAndSwitch")}
            </button>
          )}
          <button type="button" className="repo-btn small" onClick={r.clearError}>
            {t("repo.view.close")}
          </button>
        </div>
      )}

      <div className="repo-body">
        <BranchesPanel
          branches={r.branches}
          stashes={r.stashes}
          remotes={r.remotes}
          currentBranch={status?.detached ? undefined : status?.branch}
          disabled={disabled}
          onCheckout={(b, remote) => void checkout(b, remote)}
          onCreate={(name) => void run("git.checkout", { branch: name, create: true }, t("repo.view.creatingBranch"))}
          onDelete={(b) => void deleteBranch(b)}
          onMerge={(b) => void merge(b)}
          onCreateFrom={(name, from) => void run("git.checkout", { branch: name, create: true, startPoint: from }, t("repo.view.creatingBranch"))}
          onPush={(b) => void run("git.push", { branch: b }, "Push…")}
          onPull={() => void run("git.pull", {}, "Pull…")}
          onStashSave={() => void run("git.stashSave", { includeUntracked: true }, "Stash…")}
          onStashPop={(i) => void run("git.stashPop", { index: i }, "Stash pop…")}
          onStashApply={(i) => void run("git.stashApply", { index: i }, "Stash apply…")}
          onStashDrop={(i) => {
            if (window.confirm(t("repo.view.confirmDropStash"))) void run("git.stashDrop", { index: i });
          }}
        />

        <div className="repo-center">
          <div className="repo-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "changes"} className={`repo-tab${tab === "changes" ? " active" : ""}`} onClick={() => setTab("changes")}>
              {t("repo.view.tabChanges")}
              {status && status.changes.length > 0 && <span className="repo-count">{status.changes.length}</span>}
            </button>
            <button type="button" role="tab" aria-selected={tab === "history"} className={`repo-tab${tab === "history" ? " active" : ""}`} onClick={() => setTab("history")}>
              {t("repo.view.tabHistory")}
            </button>
          </div>
          <div className="repo-center-body">
            {tab === "changes" && status && (
              <ChangesPanel
                status={status}
                branch={status.detached ? undefined : status.branch}
                selected={selection}
                disabled={disabled}
                onSelect={setSelection}
                onStage={(paths) => void run("git.stage", { paths })}
                onUnstage={(paths) => void run("git.unstage", { paths })}
                onStageAll={() => void run("git.stage", { all: true })}
                onUnstageAll={() => void run("git.unstage", { all: true })}
                onDiscard={(c) => void discard(c)}
                onCommit={commit}
                onAbortMerge={() => {
                  if (window.confirm(t("repo.view.confirmAbortMerge"))) void run("git.merge", { abort: true });
                }}
              />
            )}
            {tab === "history" && (
              <CommitLog
                commits={r.commits}
                hasMore={r.hasMore}
                detail={detail}
                selectedSha={commitSha}
                selectedDiff={selection}
                disabled={disabled}
                onSelectCommit={setCommitSha}
                onSelectFile={setSelection}
                onCheckoutCommit={(sha) => {
                  if (window.confirm(t("repo.view.confirmDetach"))) void run("git.checkoutCommit", { sha });
                }}
                onLoadMore={() => void r.loadMore()}
              />
            )}
          </div>
        </div>

        <div className="repo-diff">
          <div className="repo-diff-title">
            {selection ? (
              <>
                <span className="repo-diff-path">
                  <span className="repo-diff-dir">{splitPath(selection.path).dir}</span>
                  {splitPath(selection.path).file}
                </span>
                {selection.kind === "change" && <span className="repo-chip">{selection.mode === "staged" ? "staged" : "working tree"}</span>}
              </>
            ) : (
              <span className="repo-muted">{t("repo.view.noFile")}</span>
            )}
            <div className="repo-topbar-spacer" />
            <div className="repo-segmented" role="group" aria-label={t("repo.view.diffLayout")}>
              <button type="button" className={diffLayout === "unified" ? "on" : ""} aria-pressed={diffLayout === "unified"} onClick={() => chooseDiffLayout("unified")}>
                {t("repo.view.unified")}
              </button>
              <button type="button" className={diffLayout === "split" ? "on" : ""} aria-pressed={diffLayout === "split"} onClick={() => chooseDiffLayout("split")}>
                {t("repo.view.split")}
              </button>
            </div>
          </div>
          <div className="repo-diff-body">
            <DiffViewer
              path={selection?.path ?? ""}
              modelKey={selection ? `${repo}:${selection.kind === "commit" ? selection.sha : selection.mode}:${selection.path}` : "none"}
              content={selection ? diff : null}
              loading={diffLoading}
              sideBySide={diffLayout === "split"}
            />
          </div>
        </div>
      </div>

      <footer className="repo-statusbar">
        <span className="repo-statusbar-sync">
          <span className={`repo-statusbar-dot${status && (status.ahead > 0 || status.behind > 0) ? " pending" : ""}`} />
          {!status
            ? "…"
            : !status.upstream
              ? t("repo.view.noUpstream")
              : status.ahead === 0 && status.behind === 0
                ? t("repo.view.upToDate", { upstream: status.upstream })
                : `${status.ahead > 0 ? t("repo.view.toPush", { count: status.ahead }) : ""}${status.ahead > 0 && status.behind > 0 ? " · " : ""}${status.behind > 0 ? t("repo.view.toPull", { count: status.behind }) : ""}`}
        </span>
        {status && (
          <span>
            {t(status.changes.length === 1 ? "repo.view.changeOne" : "repo.view.changeMany", { count: status.changes.length })}
          </span>
        )}
        {r.commits[0] && <span className="repo-statusbar-head">HEAD {r.commits[0].short}</span>}
      </footer>
    </div>
  );
}
