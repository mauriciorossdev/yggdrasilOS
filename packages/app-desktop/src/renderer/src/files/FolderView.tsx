import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowUpIcon, FolderOpenIcon } from "@heroicons/react/20/solid";
import { useGateway } from "@yggdrasil/client-web";
import { EntryIcon } from "./FileIcons.js";
import { isHiddenName, sortEntries } from "./fileKinds.js";
import { useI18n } from "../i18n/index.js";
import type { FsEntry, FsListResult } from "../types.js";

type Props = {
  /** Project-relative folder ("" is the project root). */
  dir: string;
  /** Label for the project root crumb. */
  rootLabel: string;
  /** Go to another folder (same tab). */
  onNavigate: (dir: string) => void;
  onOpenFile: (relativePath: string) => void;
  /** Extra controls at the start of the bar (Documents' history back button). */
  leading?: ReactNode;
};

function join(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

/**
 * A folder's contents as a main-pane view, opened as a tab in Documents or
 * Files: a clickable breadcrumb, an "up" button and the entries (folders
 * first). Clicking a folder goes into it in the same tab; clicking a file
 * opens it in its own tab, same as clicking it in the tree.
 */
export function FolderView({ dir, rootLabel, onNavigate, onOpenFile, leading }: Props) {
  const { t } = useI18n();
  const { call, onEvent } = useGateway();
  const [entries, setEntries] = useState<FsEntry[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await call<FsListResult>("fs.list", { relativePath: dir });
      setEntries(sortEntries(res.entries));
      setTruncated(Boolean(res.truncated));
      setError(null);
    } catch (err) {
      setEntries(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [call, dir]);

  useEffect(() => {
    setEntries(null);
    setError(null);
    void load();
  }, [load]);

  // Files created/renamed/deleted by an agent or the tree show up without reopening.
  useEffect(() => onEvent((ev) => ev.event === "fs.changed" && void load()), [onEvent, load]);

  const parts = dir ? dir.split("/") : [];
  const parent = parts.slice(0, -1).join("/");

  const reveal = async () => {
    const result = await window.yggdrasil.ide.revealPath(dir || ".", true);
    if (!result.opened) window.alert(result.error ?? t("folder.revealFailed"));
  };

  return (
    <div className="folder-view">
      <div className="folder-view-bar">
        {leading}
        <button
          type="button"
          className="icon-btn"
          title={t("folder.up")}
          aria-label={t("folder.up")}
          disabled={!dir}
          onClick={() => onNavigate(parent)}
        >
          <ArrowUpIcon className="hero-icon" />
        </button>
        <nav className="folder-view-crumb" aria-label={t("folder.location")} title={dir || rootLabel}>
          <button type="button" className={parts.length === 0 ? "current" : ""} onClick={() => onNavigate("")}>
            {rootLabel}
          </button>
          {parts.map((part, i) => {
            const target = parts.slice(0, i + 1).join("/");
            return (
              <span key={target} className="folder-view-crumb-seg">
                <span className="sep">/</span>
                <button
                  type="button"
                  className={i === parts.length - 1 ? "current" : ""}
                  onClick={() => onNavigate(target)}
                >
                  {part}
                </button>
              </span>
            );
          })}
        </nav>
        <span className="folder-view-spacer" />
        {entries && <span className="folder-view-count">{entries.length === 1 ? t("folder.countOne") : t("folder.count", { count: entries.length })}</span>}
        <button type="button" className="icon-btn" title={t("doc.menu.reveal")} aria-label={t("doc.menu.reveal")} onClick={() => void reveal()}>
          <FolderOpenIcon className="hero-icon" />
        </button>
      </div>

      {error && <p className="error documents-empty">{error}</p>}
      {!error && entries === null && <p className="muted documents-empty">{t("doc.loading")}</p>}
      {entries && entries.length === 0 && <p className="muted documents-empty">{t("folder.empty")}</p>}
      {entries && entries.length > 0 && (
        <div className="folder-view-list" role="list">
          {entries.map((entry) => {
            const isDir = entry.type === "directory";
            const path = join(dir, entry.name);
            return (
              <button
                key={entry.name}
                type="button"
                role="listitem"
                className={`folder-view-row${isHiddenName(entry.name) ? " hidden-entry" : ""}`}
                title={path}
                onClick={() => (isDir ? onNavigate(path) : onOpenFile(path))}
              >
                <span className="file-node-icon">
                  <EntryIcon name={entry.name} isDir={isDir} />
                </span>
                <span className="folder-view-name">{entry.name}</span>
                <span className="folder-view-kind">{isDir ? t("folder.kindFolder") : ""}</span>
              </button>
            );
          })}
          {truncated && <p className="muted folder-view-note">{t("folder.truncated")}</p>}
        </div>
      )}
    </div>
  );
}
