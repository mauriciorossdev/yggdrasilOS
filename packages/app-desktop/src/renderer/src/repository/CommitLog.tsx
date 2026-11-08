import { initials, relativeTime, splitPath } from "./format.js";
import type { CommitDetail, CommitInfo, DiffSelection } from "./types.js";
import { useI18n } from "../i18n/index.js";

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
  const { t } = useI18n();
  return (
    <div className="repo-log">
      <ul className="repo-list repo-commits">
        {p.commits.map((c, i) => (
          <li key={c.sha} className={`repo-commit${p.selectedSha === c.sha ? " active" : ""}`}>
            <button type="button" className="repo-commit-main" onClick={() => p.onSelectCommit(c.sha)} title={formatDate(c.date)}>
              <span className={`repo-lane${i === 0 ? " first" : ""}${i === p.commits.length - 1 && !p.hasMore ? " last" : ""}${c.parents.length > 1 ? " merge" : ""}`} aria-hidden="true" />
              <span className="repo-commit-body">
                <span className="repo-commit-subject">
                  <span className="repo-commit-subject-text">{c.subject}</span>
                  {c.refs.map((r) => (
                    <span key={r} className={`repo-ref${r.startsWith("tag:") ? " tag" : r.startsWith("HEAD") ? " head" : ""}`}>
                      {r.replace("HEAD -> ", "")}
                    </span>
                  ))}
                </span>
                <span className="repo-commit-meta">
                  <span className="repo-avatar" aria-hidden="true">{initials(c.author)}</span>
                  <span>{c.author}</span>
                  <span className="repo-sha">{c.short}</span>
                  <span className="repo-commit-when">{relativeTime(c.date)}</span>
                </span>
              </span>
            </button>
          </li>
        ))}
        {p.commits.length === 0 && <li className="repo-muted">{t("repo.log.noCommits")}</li>}
        {p.hasMore && (
          <li className="repo-load-more">
            <button type="button" className="repo-btn" onClick={p.onLoadMore}>
              {t("repo.log.loadMore")}
            </button>
          </li>
        )}
      </ul>

      {p.detail && (
        <div className="repo-commit-detail">
          <div className="repo-commit-detail-head">
            <strong className="repo-sha">{p.detail.sha.slice(0, 10)}</strong>
            <span>
              {p.detail.author} &lt;{p.detail.email}&gt; · {formatDate(p.detail.date)}
            </span>
            <button type="button" className="repo-btn small" disabled={p.disabled} title={t("repo.log.checkoutTip")} onClick={() => p.onCheckoutCommit(p.detail!.sha)}>
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
                      <span className="repo-change-file">{splitPath(f.path).file}</span>
                      {splitPath(f.path).dir && <span className="repo-change-dir">{splitPath(f.path).dir}</span>}
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
