import { useCallback, useEffect, useRef, useState } from "react";
import { XMarkIcon } from "@heroicons/react/20/solid";
import { useGateway } from "@yggdrasil/client-web";
import { FileTree } from "./FileTree.js";
import { TextEditor } from "./TextEditor.js";
import { FileViewer } from "./FileViewer.js";
import { previewKind } from "./filePreviewKind.js";
import { DiskConflictBar } from "../documents/DiskConflictBar.js";
import { reconcileExternalChange } from "../documents/reconcileExternalChange.js";
import type { FsReadResult } from "../types.js";

type TabState = {
  content: string;
  savedContent: string;
  loading: boolean;
  error: string | null;
  /** fs.read hit FS_READ_MAX_CHARS — partial read, never editable/savable. */
  truncated: boolean;
  totalLength?: number;
  /** Changed on disk while this tab had unsaved edits — holds the disk version until the user picks a side. */
  diskConflict?: string;
};

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

/**
 * Project file explorer as a main tab: the whole project tree on the left,
 * open files as tabs (editor / viewer) on the right. Same shape as
 * DocumentsView but rooted at the project instead of notes/, with none of its
 * Documents-only extras (feature docs, Drive sharing, persisted layout).
 */
export function FilesView() {
  const { call, onEvent } = useGateway();
  const [openPaths, setOpenPaths] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [tabs, setTabs] = useState<Record<string, TabState>>({});

  const loadTab = useCallback(
    async (path: string) => {
      // Non-text kinds are rendered by FileViewer, which does its own binary fetch.
      if (previewKind(path) !== "text") {
        setTabs((prev) => ({
          ...prev,
          [path]: { content: "", savedContent: "", loading: false, error: null, truncated: false },
        }));
        return;
      }
      setTabs((prev) => ({
        ...prev,
        [path]: { content: "", savedContent: "", loading: true, error: null, truncated: false },
      }));
      try {
        const res = await call<FsReadResult>("fs.read", { relativePath: path });
        setTabs((prev) => ({
          ...prev,
          [path]: {
            content: res.content,
            savedContent: res.content,
            loading: false,
            error: null,
            truncated: res.truncated,
            totalLength: res.totalLength,
          },
        }));
      } catch (err) {
        setTabs((prev) => ({
          ...prev,
          [path]: {
            content: "",
            savedContent: "",
            loading: false,
            error: err instanceof Error ? err.message : String(err),
            truncated: false,
          },
        }));
      }
    },
    [call],
  );

  useEffect(() => {
    if (activePath && !tabs[activePath]) void loadTab(activePath);
  }, [activePath, tabs, loadTab]);

  // Same external-edit handling as DocumentsView: clean tabs reload in place,
  // dirty tabs keep their edits and show a conflict banner.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  useEffect(
    () =>
      onEvent((ev) => {
        if (ev.event !== "fs.contentChanged") return;
        const paths = (ev.payload as { paths?: unknown } | null)?.paths;
        if (!Array.isArray(paths)) return;
        for (const path of paths) {
          if (typeof path !== "string" || !tabsRef.current[path] || previewKind(path) !== "text") continue;
          void (async () => {
            let res: FsReadResult;
            try {
              res = await call<FsReadResult>("fs.read", { relativePath: path });
            } catch {
              return; // deleted or unreadable — leave the tab as is
            }
            if (res.truncated) return;
            setTabs((prev) => {
              const tab = prev[path];
              if (!tab || tab.loading || tab.truncated) return prev;
              const action = reconcileExternalChange(tab, res.content);
              if (action === "reload") {
                return { ...prev, [path]: { ...tab, content: res.content, savedContent: res.content, diskConflict: undefined } };
              }
              if (action === "conflict" && tab.diskConflict !== res.content) {
                return { ...prev, [path]: { ...tab, diskConflict: res.content } };
              }
              return prev;
            });
          })();
        }
      }),
    [onEvent, call],
  );

  const resolveConflict = (path: string, keepMine: boolean) =>
    setTabs((prev) => {
      const tab = prev[path];
      if (!tab || tab.diskConflict === undefined) return prev;
      const disk = tab.diskConflict;
      return {
        ...prev,
        [path]: keepMine
          ? { ...tab, savedContent: disk, diskConflict: undefined }
          : { ...tab, content: disk, savedContent: disk, diskConflict: undefined },
      };
    });

  const openFile = (path: string) => {
    setOpenPaths((prev) => (prev.includes(path) ? prev : [...prev, path]));
    setActivePath(path);
  };

  const save = useCallback(
    async (path: string) => {
      const tab = tabs[path];
      // Never write back a truncated read — it would drop the rest of the file on disk.
      if (!tab || tab.content === tab.savedContent || previewKind(path) !== "text" || tab.truncated) return;
      try {
        await call("fs.write", { relativePath: path, content: tab.content });
        setTabs((prev) => ({ ...prev, [path]: { ...prev[path]!, savedContent: tab.content, diskConflict: undefined } }));
      } catch (err) {
        setTabs((prev) => ({
          ...prev,
          [path]: { ...prev[path]!, error: err instanceof Error ? err.message : String(err) },
        }));
      }
    },
    [call, tabs],
  );

  // This panel stays mounted (display:none) while hidden, so only react to
  // Ctrl+S when its own tree/editor is the thing on screen.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== "s") return;
      if (!rootRef.current || rootRef.current.offsetParent === null) return;
      e.preventDefault();
      if (activePath) void save(activePath);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activePath, save]);

  const closeTab = (path: string) => {
    const tab = tabs[path];
    if (tab && tab.content !== tab.savedContent && !window.confirm(`Discard unsaved changes to "${basename(path)}"?`)) {
      return;
    }
    setOpenPaths((prev) => {
      const next = prev.filter((p) => p !== path);
      if (activePath === path) setActivePath(next.length > 0 ? next[next.length - 1]! : null);
      return next;
    });
    setTabs((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
  };

  const activeTab = activePath ? tabs[activePath] : undefined;
  const activeKind = activePath ? previewKind(activePath) : null;

  return (
    <div className="documents-view" ref={rootRef}>
      <div className="documents-tree">
        <FileTree onOpenFile={openFile} activePath={activePath} />
      </div>
      <div className="documents-main">
        {openPaths.length > 0 && (
          <div className="documents-tabs">
            {openPaths.map((path) => {
              const dirty =
                previewKind(path) === "text" && tabs[path] && tabs[path]!.content !== tabs[path]!.savedContent;
              return (
                <div key={path} className={`documents-tab${path === activePath ? " active" : ""}`}>
                  <button type="button" className="documents-tab-label" onClick={() => setActivePath(path)} title={path}>
                    {dirty ? "● " : ""}
                    {basename(path)}
                  </button>
                  <button type="button" className="documents-tab-close" title="Close" onClick={() => closeTab(path)}>
                    <XMarkIcon className="hero-icon" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {activePath && activeKind === "text" && activeTab?.diskConflict !== undefined && (
          <DiskConflictBar
            onLoadDisk={() => resolveConflict(activePath, false)}
            onKeepMine={() => resolveConflict(activePath, true)}
          />
        )}
        <div className="documents-editor">
          {!activePath && <p className="muted documents-empty">Select a file to open it.</p>}
          {activePath && activeKind && activeKind !== "text" && <FileViewer relativePath={activePath} kind={activeKind} />}
          {activePath && activeKind === "text" && activeTab?.loading && <p className="muted documents-empty">Loading…</p>}
          {activePath && activeKind === "text" && activeTab?.error && (
            <p className="error documents-empty">{activeTab.error}</p>
          )}
          {activePath && activeKind === "text" && activeTab?.truncated && (
            <p className="muted documents-empty">
              Truncated — showing {activeTab.content.length.toLocaleString()} of{" "}
              {activeTab.totalLength?.toLocaleString()} characters. Too large to edit here.
            </p>
          )}
          {activePath && activeKind === "text" && activeTab && !activeTab.loading && !activeTab.error && (
            <TextEditor
              path={activePath}
              value={activeTab.content}
              readOnly={activeTab.truncated}
              onChange={(value) =>
                setTabs((prev) => ({ ...prev, [activePath]: { ...prev[activePath]!, content: value } }))
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
