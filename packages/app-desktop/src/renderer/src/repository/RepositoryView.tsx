import { useCallback, useEffect, useRef, useState } from "react";
import { BranchesPanel } from "./BranchesPanel.js";
import { ChangesPanel } from "./ChangesPanel.js";
import { CommitLog } from "./CommitLog.js";
import { DiffViewer } from "./DiffViewer.js";
import { RepoSelector } from "./RepoSelector.js";
import { useRepo } from "./useRepo.js";
import type { CommitDetail, DiffContent, DiffSelection, GitChange } from "./types.js";

/**
 * "Repositorio" main tab — a small git client (branches, changes, history,
 * diffs, stash, push/pull). Backed by the gateway's git.* methods
 * (packages/gateway/src/git-methods.ts), which are a direct user action: no
 * approval round trip. A project may hold zero, one or several repositories
 * (root, a parent of the root, or nested subfolders) — RepoSelector says which.
 */
export function RepositoryView() {
  const r = useRepo();
  const { call, repo, status, run } = r;
  const [tab, setTab] = useState<"changes" | "history">("changes");
  const [selection, setSelection] = useState<DiffSelection | null>(null);
  const [diff, setDiff] = useState<DiffContent | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
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
      await run("git.checkout", { branch: target, remote: isRemote }, "Cambiando de rama…");
    },
    [run, r.branches],
  );

  const stashAndRetryCheckout = useCallback(async () => {
    const last = lastCheckout.current;
    if (!last) return;
    const saved = await run("git.stashSave", { includeUntracked: true, message: `auto-stash antes de cambiar a ${last.branch}` });
    if (saved) await run("git.checkout", last, "Cambiando de rama…");
  }, [run]);

  const deleteBranch = useCallback(
    async (name: string) => {
      if (!window.confirm(`¿Borrar la rama "${name}"?`)) return;
      await run("git.branchDelete", { branch: name }, "Borrando rama…");
    },
    [run],
  );

  // Retry a failed soft delete as force once the user explicitly agrees.
  useEffect(() => {
    if (r.error?.method === "git.branchDelete" && /not fully merged/i.test(r.error.message)) {
      const m = /branch '([^']+)'/.exec(r.error.message);
      if (m && window.confirm(`La rama "${m[1]}" no está totalmente mergeada. ¿Borrarla igualmente? Se perderán sus commits no mergeados.`)) {
        void run("git.branchDelete", { branch: m[1], force: true }, "Borrando rama…");
      } else {
        r.clearError();
      }
    }
  }, [r.error]); // eslint-disable-line react-hooks/exhaustive-deps

  const merge = useCallback(
    async (name: string) => {
      if (!window.confirm(`¿Hacer merge de "${name}" en "${status?.branch ?? "la rama actual"}"?`)) return;
      const res = await run<{ ok: boolean; conflicts?: boolean }>("git.merge", { branch: name }, "Merge…");
      if (res?.conflicts) setTab("changes");
    },
    [run, status?.branch],
  );

  const discard = useCallback(
    async (c: GitChange) => {
      const untracked = c.kind === "untracked";
      const msg = untracked
        ? `¿Borrar el archivo sin rastrear "${c.path}"? No se puede deshacer.`
        : `¿Descartar los cambios de "${c.path}"? No se puede deshacer.`;
      if (!window.confirm(msg)) return;
      await run("git.discard", untracked ? { untracked: [c.path] } : { tracked: [c.path] });
    },
    [run],
  );

  const commit = useCallback(
    async (message: string, amend: boolean) => {
      if (amend && !window.confirm("Amend reescribe el último commit. ¿Continuar?")) return false;
      return (await run("git.commit", { message, amend }, "Commit…")) !== null;
    },
    [run],
  );

  const push = useCallback(async () => {
    if (!status?.upstream && status?.branch) {
      await run("git.push", { setUpstream: true, branch: status.branch }, "Push…");
    } else {
      await run("git.push", {}, "Push…");
    }
  }, [run, status?.upstream, status?.branch]);

  if (r.repos === null) return <div className="repo-view"><div className="repo-empty">Buscando repositorios…</div></div>;

  if (r.repos.length === 0) {
    return (
      <div className="repo-view">
        <div className="repo-empty">
          <p>Este proyecto no tiene ningún repositorio git (ni en la raíz ni en subcarpetas).</p>
          <button type="button" className="repo-btn primary" disabled={disabled} onClick={() => void run("git.init", {}, "git init…")}>
            Inicializar repositorio en la raíz
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
        <div className="repo-topbar-spacer" />
        {status && (
          <span className="repo-head" title={status.upstream ? `Sigue a ${status.upstream}` : "Sin upstream"}>
            {status.detached ? "HEAD desacoplado" : (status.branch ?? "—")}
            {status.ahead > 0 && <span className="repo-ahead-behind"> ↑{status.ahead}</span>}
            {status.behind > 0 && <span className="repo-ahead-behind"> ↓{status.behind}</span>}
          </span>
        )}
        <button type="button" className="repo-btn" disabled={disabled} onClick={() => void run("git.fetch", {}, "Fetch…")}>
          Fetch
        </button>
        <button type="button" className="repo-btn" disabled={disabled} onClick={() => void run("git.pull", {}, "Pull…")} title="Pull (solo fast-forward)">
          Pull
        </button>
        <button type="button" className="repo-btn" disabled={disabled || !status?.branch} onClick={() => void push()}>
          Push
        </button>
        <button type="button" className="repo-btn" disabled={disabled} onClick={() => void r.reload()} title="Refrescar">
          ⟳
        </button>
        {r.busy && <span className="repo-muted">{r.busy}</span>}
      </div>

      {!rootIsRepo && (
        <div className="repo-banner info">
          La raíz del proyecto no es un repositorio; se muestran los {r.repos.length} encontrados en subcarpetas.
        </div>
      )}

      {r.error && (
        <div className="repo-banner error">
          <pre className="repo-error-text">{r.error.message}</pre>
          {r.error.method === "git.checkout" && lastCheckout.current && /overwritten|local changes|would be/i.test(r.error.message) && (
            <button type="button" className="repo-btn small" disabled={disabled} onClick={() => void stashAndRetryCheckout()}>
              Guardar en stash y cambiar
            </button>
          )}
          <button type="button" className="repo-btn small" onClick={r.clearError}>
            Cerrar
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
          onCreate={(name) => void run("git.checkout", { branch: name, create: true }, "Creando rama…")}
          onDelete={(b) => void deleteBranch(b)}
          onMerge={(b) => void merge(b)}
          onCreateFrom={(name, from) => void run("git.checkout", { branch: name, create: true, startPoint: from }, "Creando rama…")}
          onPush={(b) => void run("git.push", { branch: b }, "Push…")}
          onPull={() => void run("git.pull", {}, "Pull…")}
          onStashSave={() => void run("git.stashSave", { includeUntracked: true }, "Stash…")}
          onStashPop={(i) => void run("git.stashPop", { index: i }, "Stash pop…")}
          onStashApply={(i) => void run("git.stashApply", { index: i }, "Stash apply…")}
          onStashDrop={(i) => {
            if (window.confirm("¿Borrar este stash? No se puede deshacer.")) void run("git.stashDrop", { index: i });
          }}
        />

        <div className="repo-center">
          <div className="repo-tabs">
            <button type="button" className={`repo-tab${tab === "changes" ? " active" : ""}`} onClick={() => setTab("changes")}>
              Cambios{status && status.changes.length > 0 ? ` (${status.changes.length})` : ""}
            </button>
            <button type="button" className={`repo-tab${tab === "history" ? " active" : ""}`} onClick={() => setTab("history")}>
              Historial
            </button>
          </div>
          <div className="repo-center-body">
            {tab === "changes" && status && (
              <ChangesPanel
                status={status}
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
                  if (window.confirm("¿Abortar el merge en curso?")) void run("git.merge", { abort: true });
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
                  if (window.confirm("Esto deja el repositorio con HEAD desacoplado. ¿Continuar?")) void run("git.checkoutCommit", { sha });
                }}
                onLoadMore={() => void r.loadMore()}
              />
            )}
          </div>
        </div>

        <div className="repo-diff">
          {selection && <div className="repo-diff-title">{selection.path}</div>}
          <div className="repo-diff-body">
            <DiffViewer
              path={selection?.path ?? ""}
              modelKey={selection ? `${repo}:${selection.kind === "commit" ? selection.sha : selection.mode}:${selection.path}` : "none"}
              content={selection ? diff : null}
              loading={diffLoading}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
