import { useEffect, useRef, useState } from "react";
import { ArrowDownTrayIcon, XMarkIcon } from "@heroicons/react/20/solid";
import { useGateway } from "@yggdrasil/client-web";
import type { FsReadResult } from "../types.js";
import { TextEditor } from "./TextEditor.js";
import { FileViewer } from "./FileViewer.js";
import { previewKind } from "./filePreviewKind.js";
import { reconcileExternalChange } from "../documents/reconcileExternalChange.js";
import { DiskConflictBar } from "../documents/DiskConflictBar.js";
import { FeatureProgress } from "../documents/FeatureProgress.js";

type Props = {
  relativePath: string;
  onClose: () => void;
  style?: React.CSSProperties;
  /** Extra class alongside "file-content-panel" — e.g. "file-content-panel-drawer" for the Terminal-tab overlay mode. */
  className?: string;
};
export function FileContentPanel({ relativePath, onClose, style, className }: Props) {
  const { call, onEvent } = useGateway();
  const kind = previewKind(relativePath);
  const [result, setResult] = useState<FsReadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState("");
  // What's on disk as far as this panel knows (loaded or last saved) — the
  // baseline for both `dirty` and for spotting an outside edit (see below).
  const [savedContent, setSavedContent] = useState("");
  const [diskConflict, setDiskConflict] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (kind !== "text") return;
    setResult(null);
    setError(null);
    setDirty(false);
    setDiskConflict(null);
    (async () => {
      try {
        const res = await call<FsReadResult>("fs.read", { relativePath });
        setResult(res);
        setContent(res.content);
        setSavedContent(res.content);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [call, relativePath, kind]);

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      await call("fs.write", { relativePath, content });
      setSavedContent(content);
      setDiskConflict(null);
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  // Cmd/Ctrl+S saves regardless of where focus is inside the panel (Monaco
  // captures most keys itself, but not reliably enough to rely on its own
  // onKeyDown for a cross-app-wide shortcut) — a window-level listener plus
  // preventDefault is the only way to also stop the OS/browser save dialog.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, content, relativePath]);

  // Same live-reload rule as DocumentsView's tabs: an agent can edit the file
  // while it's open here. Clean -> reload in place; unsaved edits -> keep
  // them and offer a choice instead of letting Ctrl+S clobber the outside edit.
  const liveRef = useRef({ content, savedContent });
  liveRef.current = { content, savedContent };
  useEffect(() => {
    if (kind !== "text") return;
    return onEvent((ev) => {
      if (ev.event !== "fs.contentChanged") return;
      const paths = (ev.payload as { paths?: unknown } | null)?.paths;
      if (!Array.isArray(paths) || !paths.includes(relativePath)) return;
      void (async () => {
        let res: FsReadResult;
        try {
          res = await call<FsReadResult>("fs.read", { relativePath });
        } catch {
          return; // deleted or unreadable — leave the panel as is
        }
        if (res.truncated) return;
        const action = reconcileExternalChange(liveRef.current, res.content);
        if (action === "reload") {
          setResult(res);
          setContent(res.content);
          setSavedContent(res.content);
          setDiskConflict(null);
          setDirty(false);
        } else if (action === "conflict") {
          setDiskConflict(res.content);
        }
      })();
    });
  }, [call, onEvent, relativePath, kind]);

  const resolveConflict = (keepMine: boolean) => {
    if (diskConflict === null) return;
    setSavedContent(diskConflict);
    if (!keepMine) {
      setContent(diskConflict);
      setDirty(false);
    }
    setDiskConflict(null);
  };

  const requestClose = () => {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    onClose();
  };

  // A truncated read (fs.read's 50k-char cap) must never be edited — saving
  // it back would silently drop the rest of the file on disk.
  const editable = kind === "text" && result !== null && !result.truncated;

  return (
    <aside className={`file-content-panel${className ? ` ${className}` : ""}`} style={style}>
      <div className="file-content-panel-header">
        <div className="file-content-panel-title">
          <span className="file-content-panel-path" title={relativePath}>
            {dirty ? "● " : ""}
            {relativePath}
          </span>
          {editable && (
            <button
              type="button"
              className="icon-btn"
              onClick={() => void save()}
              disabled={!dirty || saving}
              title="Save (Cmd/Ctrl+S)"
            >
              {saving ? "…" : <ArrowDownTrayIcon className="hero-icon" />}
            </button>
          )}
        </div>
        <button type="button" className="icon-btn" onClick={requestClose} title="Close">
          <XMarkIcon className="hero-icon" />
        </button>
      </div>
      {kind === "text" && diskConflict !== null && (
        <DiskConflictBar onLoadDisk={() => resolveConflict(false)} onKeepMine={() => resolveConflict(true)} />
      )}
      {editable && /\.md$/i.test(relativePath) && <FeatureProgress content={content} />}
      <div className="file-content-panel-body">
        {kind !== "text" ? (
          <FileViewer relativePath={relativePath} kind={kind} />
        ) : (
          <>
            {error && <p className="error">{error}</p>}
            {!error && !result && <p className="muted">Loading…</p>}
            {result?.truncated && (
              <p className="muted">
                Truncated — showing {result.content.length.toLocaleString()} of{" "}
                {result.totalLength?.toLocaleString()} characters. Too large to edit here.
              </p>
            )}
            {result &&
              (editable ? (
                <div className="file-editor">
                  <TextEditor
                    path={relativePath}
                    value={content}
                    onChange={(v) => {
                      setContent(v);
                      setDirty(v !== savedContent);
                    }}
                  />
                </div>
              ) : (
                <pre className="file-content-pre">{result.content}</pre>
              ))}
          </>
        )}
      </div>
    </aside>
  );
}
