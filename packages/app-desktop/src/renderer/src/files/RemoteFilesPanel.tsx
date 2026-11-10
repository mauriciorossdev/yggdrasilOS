import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowPathIcon } from "@heroicons/react/20/solid";
import { useGateway } from "@yggdrasil/client-web";
import { ChangeList, ChangeViewToggle, TREE_INDENT } from "../repository/ChangeList.js";
import { useChangeViewMode } from "../repository/useChangeViewMode.js";
import { repoToProjectPath, splitPath } from "../repository/format.js";
import type { GitChange, RepoInfo, RepoStatus } from "../repository/types.js";
import { useI18n } from "../i18n/index.js";

const REFRESH_DEBOUNCE_MS = 500;

/** What the side panel needs to show one file's diff. */
export type DiffTarget = { path: string; filePath?: string };

const changePath = (c: GitChange) => c.path;

/** One letter per file: the working-tree change if any, else the staged one. */
function letterOf(c: GitChange): string {
  if (c.kind === "unmerged") return "!";
  if (c.kind === "untracked") return "?";
  return c.worktree !== "." ? c.worktree : c.index;
}

const BADGE_CLASS: Record<string, string> = {
  M: "modified",
  T: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "renamed",
  "?": "untracked",
  "!": "unmerged",
};

type Props = {
  onOpenDiff: (target: DiffTarget) => void;
  /** The repo path of the diff open in the side panel, to mark its row. */
  activePath?: string;
};

/**
 * The sidebar's "Remote Diff" list: every uncommitted change of the repo that
 * holds the project, as a list or a folder tree. A click opens that file's
 * diff in the side panel.
 */
export function RemoteFilesPanel({ onOpenDiff, activePath }: Props) {
  const { t } = useI18n();
  const { call, onEvent } = useGateway();
  const [mode, setMode] = useChangeViewMode();
  const [status, setStatus] = useState<RepoStatus | null>(null);
  const [notRepo, setNotRepo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Where the project sits inside the repo ("" when it is the repo root).
  const [prefix, setPrefix] = useState("");
  const timer = useRef<number | undefined>(undefined);

  const reload = useCallback(async () => {
    try {
      const res = await call<RepoStatus>("git.status2", { repo: "." });
      setStatus(res);
      setNotRepo(false);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/not a git repository/i.test(message)) {
        setNotRepo(true);
        setStatus(null);
        setError(null);
      } else {
        setError(message);
      }
    }
  }, [call]);

  useEffect(() => {
    void reload();
    let cancelled = false;
    call<{ repos: RepoInfo[] }>("git.repos", {})
      .then((res) => {
        const parent = res.repos.find((r) => r.relation === "parent");
        if (!cancelled) setPrefix(parent?.prefix ?? "");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [call, reload]);

  // Same signals useGitChanges listens to: any write, rename or delete under the project may change the status.
  useEffect(
    () =>
      onEvent((ev) => {
        if (ev.event !== "fs.changed" && ev.event !== "fs.contentChanged") return;
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => void reload(), REFRESH_DEBOUNCE_MS);
      }),
    [onEvent, reload],
  );
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const open = (c: GitChange) => {
    const letter = letterOf(c);
    const deleted = letter === "D";
    onOpenDiff({ path: c.path, filePath: deleted ? undefined : repoToProjectPath(c.path, prefix) });
  };

  return (
    <div className="git-remote-panel">
      <div className="git-remote-header">
        <span className="git-branch-label">{status ? (status.detached ? "(detached)" : status.branch ?? "") : ""}</span>
        {status && status.changes.length > 0 && <ChangeViewToggle mode={mode} onChange={setMode} />}
        <button type="button" className="icon-btn" title={t("doc.refresh")} onClick={() => void reload()}>
          <ArrowPathIcon className="hero-icon" />
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {!error && !status && !notRepo && <p className="muted">{t("doc.loading")}</p>}
      {!error && notRepo && <p className="muted">{t("doc.remote.notRepo")}</p>}
      {!error && status && status.changes.length === 0 && <p className="muted">{t("doc.remote.noChanges")}</p>}

      {status && status.changes.length > 0 && (
        <ul className="git-remote-list">
          <ChangeList
            items={status.changes}
            getPath={changePath}
            mode={mode}
            renderRow={(c, ctx) => {
              const letter = letterOf(c);
              const { dir, file } = splitPath(c.path);
              return (
                <li key={c.path}>
                  <button
                    type="button"
                    className={`git-status-row${c.path === activePath ? " active" : ""}`}
                    style={ctx.tree ? { paddingLeft: ctx.depth * TREE_INDENT + 6 } : undefined}
                    title={c.origPath ? `${c.origPath} → ${c.path}` : c.path}
                    onClick={() => open(c)}
                  >
                    <span className={`git-status-badge ${BADGE_CLASS[letter] ?? "modified"}`}>{letter}</span>
                    <span className="git-status-path">{ctx.tree ? file : `${dir}${file}`}</span>
                  </button>
                </li>
              );
            }}
          />
        </ul>
      )}
    </div>
  );
}
