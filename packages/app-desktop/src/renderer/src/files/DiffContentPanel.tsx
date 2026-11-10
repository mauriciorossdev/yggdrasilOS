import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { DocumentTextIcon, XMarkIcon } from "@heroicons/react/20/solid";
import { useGateway } from "@yggdrasil/client-web";
import { DiffViewer } from "../repository/DiffViewer.js";
import { readDiffLayout, writeDiffLayout, type DiffLayout } from "../repository/diffLayout.js";
import type { DiffContent } from "../repository/types.js";
import { useI18n } from "../i18n/index.js";

const REFRESH_DEBOUNCE_MS = 400;

type Props = {
  /** Relative to the root of the repo that holds the project. */
  path: string;
  /** The same file relative to the project; without it there's no "Open file". */
  filePath?: string;
  onOpenFile: (relativePath: string) => void;
  onClose: () => void;
  /** Extra controls in the header, before Close. */
  headerActions?: ReactNode;
  style?: CSSProperties;
  /** Extra class alongside "file-content-panel" — same convention as FileContentPanel.tsx. */
  className?: string;
};

/**
 * One file's uncommitted changes (HEAD against the working tree, staged or
 * not) in ChatView's side panel — what a click in the sidebar's Remote Diff
 * opens. Same outer shell as FileContentPanel, so the side panel layout
 * doesn't change between the two.
 */
export function DiffContentPanel({ path, filePath, onOpenFile, onClose, headerActions, style, className }: Props) {
  const { t } = useI18n();
  const { call, onEvent } = useGateway();
  const [diff, setDiff] = useState<DiffContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [layout, setLayout] = useState<DiffLayout>(readDiffLayout);
  const [version, setVersion] = useState(0);
  const timer = useRef<number | undefined>(undefined);

  // Keeps the previous diff on screen while a refresh loads, so an agent's edits don't flicker it.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    call<DiffContent>("git.diff2", { repo: ".", path, mode: "head" })
      .then((res) => {
        if (cancelled) return;
        setDiff(res);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setDiff(null);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [call, path, version]);

  useEffect(
    () =>
      onEvent((ev) => {
        if (ev.event !== "fs.changed" && ev.event !== "fs.contentChanged") return;
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setVersion((v) => v + 1), REFRESH_DEBOUNCE_MS);
      }),
    [onEvent],
  );
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const chooseLayout = (next: DiffLayout) => {
    setLayout(next);
    writeDiffLayout(next);
  };

  return (
    <aside className={`file-content-panel${className ? ` ${className}` : ""}`} style={style}>
      <div className="file-content-panel-header">
        <div className="file-content-panel-title">
          <span className="file-content-panel-path" title={path}>
            {path}
          </span>
          <span className="repo-chip">{t("diffPanel.uncommitted")}</span>
        </div>
        <div className="repo-segmented diff-panel-layout" role="group" aria-label={t("repo.view.diffLayout")}>
          <button type="button" className={layout === "unified" ? "on" : ""} aria-pressed={layout === "unified"} onClick={() => chooseLayout("unified")}>
            {t("repo.view.unified")}
          </button>
          <button type="button" className={layout === "split" ? "on" : ""} aria-pressed={layout === "split"} onClick={() => chooseLayout("split")}>
            {t("repo.view.split")}
          </button>
        </div>
        {filePath !== undefined && (
          <button
            type="button"
            className="icon-btn"
            title={t("diffPanel.openFile")}
            aria-label={t("diffPanel.openFile")}
            onClick={() => onOpenFile(filePath)}
          >
            <DocumentTextIcon className="hero-icon" />
          </button>
        )}
        {headerActions}
        <button type="button" className="icon-btn" onClick={onClose} title={t("doc.close")}>
          <XMarkIcon className="hero-icon" />
        </button>
      </div>
      <div className="file-content-panel-body diff-panel-body">
        {error ? (
          <p className="error">{error}</p>
        ) : (
          <DiffViewer path={path} modelKey={`side:${path}`} content={diff} loading={loading} sideBySide={layout === "split"} />
        )}
      </div>
    </aside>
  );
}
