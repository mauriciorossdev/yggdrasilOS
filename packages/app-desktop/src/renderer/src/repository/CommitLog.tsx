import type { CommitDetail, CommitInfo, DiffSelection } from "./types.js";

type Props = {
  commits: CommitInfo[];
  hasMore: boolean;
  detail: CommitDetail | null;
  selectedSha: string | null;
  selectedDiff: DiffSelection | null;
  disabled: boolean;
  onSelectCommit: (sha: string) => void;
  onSelectFile: (sel: DiffSelection) => void;
  onCheckoutCommit: (sha: string) => void;
  onLoadMore: () => void;
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function CommitLog(p: Props) {
  return (
    <div className="repo-log">
      <ul className="repo-list repo-commits">
        {p.commits.map((c) => (
          <li key={c.sha} className={`repo-commit${p.selectedSha === c.sha ? " active" : ""}`}>
            <button type="button" className="repo-commit-main" onClick={() => p.onSelectCommit(c.sha)}>
              <span className="repo-commit-subject">
                {c.refs.map((r) => (
                  <span key={r} className={`repo-ref${r.startsWith("tag:") ? " tag" : r.startsWith("HEAD") ? " head" : ""}`}>
                    {r.replace("HEAD -> ", "")}
                  </span>
                ))}
                {c.subject}
              </span>
              <span className="repo-commit-meta">
                {c.short} · {c.author} · {formatDate(c.date)}
              </span>
            </button>
          </li>
        ))}
        {p.commits.length === 0 && <li className="repo-muted">Sin commits</li>}
        {p.hasMore && (
          <li>
            <button type="button" className="repo-btn small" onClick={p.onLoadMore}>
              Cargar más
            </button>
          </li>
        )}
      </ul>

      {p.detail && (
        <div className="repo-commit-detail">
          <div className="repo-commit-detail-head">
            <strong>{p.detail.sha.slice(0, 10)}</strong>
            <span>
              {p.detail.author} &lt;{p.detail.email}&gt; · {formatDate(p.detail.date)}
            </span>
            <button type="button" className="repo-btn small" disabled={p.disabled} title="Cambiar a este commit (HEAD desacoplado)" onClick={() => p.onCheckoutCommit(p.detail!.sha)}>
              Checkout
            </button>
          </div>
          <pre className="repo-commit-message">{p.detail.message}</pre>
          <ul className="repo-list">
            {p.detail.files.map((f) => {
              const active =
                p.selectedDiff?.kind === "commit" && p.selectedDiff.sha === p.detail!.sha && p.selectedDiff.path === f.path;
              return (
                <li key={f.path} className={`repo-change${active ? " active" : ""}`}>
                  <button
                    type="button"
                    className="repo-change-main"
                    onClick={() => p.onSelectFile({ kind: "commit", sha: p.detail!.sha, path: f.path, origPath: f.origPath })}
                    title={f.origPath ? `${f.origPath} → ${f.path}` : f.path}
                  >
                    <span className={`repo-letter l-${f.status}`}>{f.status}</span>
                    <span className="repo-change-name">
                      <span className="repo-change-file">{f.path}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
