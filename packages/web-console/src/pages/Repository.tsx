import { useCallback, useEffect, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";
import { Chip } from "@yggdrasil/ui-kit";
import { lineDiff, withContext } from "../lib/lineDiff";
import { useT } from "../i18n";

type Repo = { path: string; name: string; branch?: string; relation: "root" | "parent" | "child" };
type Change = { path: string; origPath?: string; index: string; worktree: string; kind: "changed" | "renamed" | "unmerged" | "untracked" };
type Status = { branch?: string; detached: boolean; upstream?: string; ahead: number; behind: number; changes: Change[]; merging: boolean };
type Commit = { sha: string; short: string; author: string; date: string; refs: string[]; subject: string };
type CommitDetail = { sha: string; author: string; date: string; message: string; files: Array<{ status: string; path: string }> };
type Diff = { original: string; modified: string; binary?: boolean; tooLarge?: boolean };
type Selection = { kind: "change"; change: Change; staged: boolean } | { kind: "commit"; sha: string };

/**
 * Read-only view of the project's git repos: branch, pending changes with their diff,
 * history and what each commit touched. Committing, pushing and branching stay in the app.
 * git.* only answers this machine or a trusted device.
 */
export function RepositoryPage() {
  const { call, connected } = useGateway();
  const t = useT();
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [repo, setRepo] = useState(".");
  const [status, setStatus] = useState<Status | null>(null);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [diff, setDiff] = useState<Diff | null>(null);
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await call<{ repos: Repo[] }>("git.repos");
      setRepos(r.repos);
      const current = r.repos.some((x) => x.path === repo) ? repo : (r.repos[0]?.path ?? ".");
      if (r.repos.length === 0) return;
      setRepo(current);
      const [s, l] = await Promise.all([
        call<Status>("git.status2", { repo: current }),
        call<{ commits: Commit[] }>("git.log", { repo: current, limit: 40 }),
      ]);
      setStatus(s);
      setCommits(l.commits);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRepos((prev) => prev ?? []);
    }
  }, [call, repo]);

  useEffect(() => {
    if (connected) void load();
  }, [connected, load]);

  useEffect(() => {
    setDiff(null);
    setDetail(null);
    if (!selection) return;
    if (selection.kind === "change") {
      const mode = selection.staged ? "staged" : "unstaged";
      call<Diff>("git.diff2", { repo, path: selection.change.path, mode })
        .then(setDiff)
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    } else {
      call<CommitDetail>("git.show", { repo, sha: selection.sha })
        .then(setDetail)
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    }
  }, [selection, repo, call]);

  const staged = (status?.changes ?? []).filter((c) => c.index !== "." && c.kind !== "untracked");
  const unstaged = (status?.changes ?? []).filter((c) => c.worktree !== "." || c.kind === "untracked");

  const changeRow = (c: Change, isStaged: boolean) => (
    <li key={`${isStaged}-${c.path}`}>
      <button
        type="button"
        className={`pick-item row-item${selection?.kind === "change" && selection.change.path === c.path && selection.staged === isStaged ? " active" : ""}`}
        onClick={() => setSelection({ kind: "change", change: c, staged: isStaged })}
      >
        <span className={`change-code change-${c.kind}`}>{c.kind === "untracked" ? "U" : isStaged ? c.index : c.worktree}</span>
        <span className="mono">{c.path}</span>
      </button>
    </li>
  );

  return (
    <div className="page">
      <h1>{t("nav.repository")}</h1>
      {error && <p className="error">{error}</p>}
      {repos === null ? (
        <p className="muted">{t("common.loading")}</p>
      ) : repos.length === 0 ? (
        <p className="muted">{t("repo.none")}</p>
      ) : (
        <>
          <div className="row repo-bar">
            {repos.length > 1 && (
              <select value={repo} onChange={(e) => setRepo(e.target.value)}>
                {repos.map((r) => (
                  <option key={r.path} value={r.path}>
                    {r.name}
                  </option>
                ))}
              </select>
            )}
            {status && (
              <>
                <Chip tone="accent">{status.detached ? t("repo.detached") : status.branch}</Chip>
                {status.upstream && (
                  <span className="muted">
                    {status.upstream} · ↑{status.ahead} ↓{status.behind}
                  </span>
                )}
                {status.merging && <Chip tone="attention">{t("repo.merging")}</Chip>}
              </>
            )}
            <span className="grow" />
            <button type="button" className="secondary" onClick={() => void load()}>
              {t("repo.refresh")}
            </button>
          </div>
          <div className="split">
            <aside className="card list-pane">
              <h3>{t("repo.changes", { count: (status?.changes ?? []).length })}</h3>
              {staged.length > 0 && (
                <>
                  <p className="muted small-title">{t("repo.staged")}</p>
                  <ul className="pick-list">{staged.map((c) => changeRow(c, true))}</ul>
                </>
              )}
              {unstaged.length > 0 && (
                <>
                  <p className="muted small-title">{t("repo.unstaged")}</p>
                  <ul className="pick-list">{unstaged.map((c) => changeRow(c, false))}</ul>
                </>
              )}
              {status && status.changes.length === 0 && <p className="muted">{t("repo.clean")}</p>}
              <h3>{t("repo.history")}</h3>
              <ul className="pick-list">
                {commits.map((c) => (
                  <li key={c.sha}>
                    <button
                      type="button"
                      className={`pick-item${selection?.kind === "commit" && selection.sha === c.sha ? " active" : ""}`}
                      onClick={() => setSelection({ kind: "commit", sha: c.sha })}
                    >
                      <span>{c.subject}</span>
                      <span className="muted pick-sub">
                        <span className="mono">{c.short}</span> · {c.author} · {new Date(c.date).toLocaleDateString()}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </aside>
            <section className="card detail-pane">
              {!selection ? (
                <p className="muted">{t("repo.pick")}</p>
              ) : selection.kind === "change" ? (
                !diff ? (
                  <p className="muted">{t("common.loading")}</p>
                ) : (
                  <DiffView path={selection.change.path} diff={diff} />
                )
              ) : !detail ? (
                <p className="muted">{t("common.loading")}</p>
              ) : (
                <div>
                  <pre className="commit-message">{detail.message}</pre>
                  <p className="muted">
                    <span className="mono">{detail.sha.slice(0, 10)}</span> · {detail.author} · {new Date(detail.date).toLocaleString()}
                  </p>
                  <ul className="plain-list">
                    {detail.files.map((f) => (
                      <li key={f.path}>
                        <span className={`change-code change-${f.status === "A" ? "untracked" : "changed"}`}>{f.status}</span>{" "}
                        <span className="mono">{f.path}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function DiffView({ path, diff }: { path: string; diff: Diff }) {
  const t = useT();
  if (diff.binary) return <p className="muted">{t("repo.binary")}</p>;
  const lines = diff.tooLarge ? null : lineDiff(diff.original, diff.modified);
  if (!lines) return <p className="muted">{t("repo.tooBig")}</p>;
  const shown = withContext(lines);
  return (
    <div>
      <p className="mono muted">{path}</p>
      <div className="diff">
        {shown.map((l, i) =>
          l.kind === "gap" ? (
            <div key={i} className="diff-gap">
              {t("repo.unchanged", { count: l.count })}
            </div>
          ) : (
            <div key={i} className={`diff-line diff-${l.kind}`}>
              <span className="diff-no">{l.oldNo ?? ""}</span>
              <span className="diff-no">{l.newNo ?? ""}</span>
              <span className="diff-sign">{l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}</span>
              <span className="diff-text">{l.text}</span>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
