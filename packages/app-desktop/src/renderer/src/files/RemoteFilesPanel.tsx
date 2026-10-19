import { useCallback, useEffect, useState } from "react";
import { ArrowPathIcon } from "@heroicons/react/20/solid";
import { useGateway } from "@yggdrasil/client-web";
import type { GitFileEntry, GitDiffResult, GitStatusResult } from "../types.js";

const STATUS_BADGE: Record<GitFileEntry["status"], string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "?",
  unmerged: "!",
};

function DiffLines({ diff }: { diff: string }) {
  return (
    <pre className="git-diff-pre">
      {diff.split("\n").map((line, i) => {
        let cls = "";
        if (line.startsWith("@@")) cls = "git-diff-hunk";
        else if (line.startsWith("+") && !line.startsWith("+++")) cls = "git-diff-add";
        else if (line.startsWith("-") && !line.startsWith("---")) cls = "git-diff-del";
        return (
          <div key={i} className={cls}>
            {line.length > 0 ? line : " "}
          </div>
        );
      })}
    </pre>
  );
}

export function RemoteFilesPanel() {
  const { call, onEvent } = useGateway();
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<Record<string, string>>({});
  const [diffError, setDiffError] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await call<GitStatusResult>("git.status", {});
      setStatus(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [call]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Same live-refresh signal FileTree.tsx uses for the local tree — any
  // write/rename/delete anywhere under the project root likely changes the
  // git status too, and there's no git-specific push event to listen for
  // instead.
  useEffect(() => onEvent((ev) => ev.event === "fs.changed" && void reload()), [onEvent, reload]);

  const loadDiff = useCallback(
    async (entry: GitFileEntry) => {
      setDiffLoading(entry.path);
      setDiffError(null);
      try {
        const res = await call<GitDiffResult>("git.diff", {
          relativePath: entry.path,
          untracked: entry.status === "untracked",
        });
        setDiffs((prev) => ({ ...prev, [entry.path]: res.diff }));
      } catch (err) {
        setDiffError(err instanceof Error ? err.message : String(err));
      } finally {
        setDiffLoading(null);
      }
    },
    [call],
  );

  const toggleExpand = (entry: GitFileEntry) => {
    if (expandedPath === entry.path) {
      setExpandedPath(null);
      return;
    }
    setExpandedPath(entry.path);
    if (diffs[entry.path] === undefined) void loadDiff(entry);
  };

  return (
    <div className="git-remote-panel">
      <div className="git-remote-header">
        <span className="git-branch-label">{status?.isRepo ? status.branch || "(detached)" : ""}</span>
        <button type="button" className="icon-btn" title="Refresh" onClick={() => void reload()}>
          <ArrowPathIcon className="hero-icon" />
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {!error && !status && <p className="muted">Loading…</p>}
      {!error && status && !status.isRepo && <p className="muted">This project is not a git repository.</p>}
      {!error && status?.isRepo && status.files.length === 0 && <p className="muted">No changes.</p>}

      {status?.isRepo &&
        status.files.map((entry) => (
          <div key={entry.path}>
            <button type="button" className="git-status-row" onClick={() => toggleExpand(entry)}>
              <span className={`git-status-badge ${entry.status}`}>{STATUS_BADGE[entry.status]}</span>
              <span className="git-status-path">{entry.path}</span>
            </button>
            {expandedPath === entry.path && (
              <>
                {diffLoading === entry.path && <p className="muted">Loading diff…</p>}
                {diffError && diffLoading !== entry.path && <p className="error">{diffError}</p>}
                {diffs[entry.path] !== undefined && <DiffLines diff={diffs[entry.path]!} />}
              </>
            )}
          </div>
        ))}
    </div>
  );
}
