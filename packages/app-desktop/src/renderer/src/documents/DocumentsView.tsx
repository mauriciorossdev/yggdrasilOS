import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftIcon, ArrowTopRightOnSquareIcon, XMarkIcon } from "@heroicons/react/20/solid";
import { useGateway } from "@yggdrasil/client-web";
import { onRequestOpenDocument } from "../chat/documentsBridge.js";
import { FileTree } from "../files/FileTree.js";
import { TextEditor, type RevealTarget } from "../files/TextEditor.js";
import type { OpenTarget } from "../files/FileSearchResults.js";
import { FileViewer } from "../files/FileViewer.js";
import { previewKind } from "../files/filePreviewKind.js";
import { DocumentsTabContextMenu } from "./DocumentsTabContextMenu.js";
import { reconcileExternalChange } from "./reconcileExternalChange.js";
import { buildFeatureDoc, FEATURES_DIR, featureDocPath } from "./featureDoc.js";
import { FeatureProgress } from "./FeatureProgress.js";
import { DiskConflictBar } from "./DiskConflictBar.js";
import { AUTOSAVE_DELAY_MS, saveStatus, shouldAutosave } from "./autosave.js";
import { SaveIndicator } from "./SaveIndicator.js";
import { useNotesIndex } from "./useNotesIndex.js";
import { buildBacklinks, wikiItems } from "./notesIndex.js";
import { useI18n } from "../i18n/index.js";
import { releaseModel } from "../files/lsp/service.js";
import type { FsListResult, FsReadResult } from "../types.js";

const NOTES_ROOT = "notes";
const SAVE_DEBOUNCE_MS = 400;

type TabState = {
  content: string;
  savedContent: string;
  loading: boolean;
  error: string | null;
  /** fs.read hit FS_READ_MAX_CHARS — content is a partial read; never editable/savable (would silently truncate the file on disk). */
  truncated: boolean;
  totalLength?: number;
  /** The file changed on disk while this tab had unsaved edits — holds the disk version until the user picks a side. */
  diskConflict?: string;
  /** Last write attempt. A failed save keeps the edits on screen (unlike `error`, which replaces the editor). */
  saveState?: "saving" | "saved" | "error";
  saveError?: string;
};

type DriveShareState = {
  loading: boolean;
  error: string | null;
  webViewLink: string | null;
};

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

/** The open note's location, `notes / folder / file.md`, with the file name stressed. */
function Breadcrumb({ path }: { path: string }) {
  const { t } = useI18n();
  const parts = path.split("/");
  return (
    <nav className="documents-crumb" aria-label={t("docs.crumb.label")} title={path}>
      {parts.map((part, i) => (
        <span key={`${i}:${part}`} className={i === parts.length - 1 ? "current" : ""}>
          {i > 0 && <span className="sep">/</span>}
          {part}
        </span>
      ))}
    </nav>
  );
}

export function DocumentsView() {
  const { t } = useI18n();
  const { call, onEvent } = useGateway();
  const [ready, setReady] = useState(false);
  const [openPaths, setOpenPaths] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [tabs, setTabs] = useState<Record<string, TabState>>({});
  const [driveShares, setDriveShares] = useState<Record<string, DriveShareState>>({});
  const hydratedRef = useRef(false);
  // Titles and links between notes: what the `[[` picker offers and the Backlinks tab lists.
  const notesIndex = useNotesIndex(NOTES_ROOT, ready);

  // Back-navigation stack: every time activePath changes to a genuinely
  // different path, the path it moved *away from* is pushed here — a plain
  // linear history (like a browser's back button), not per-tab. goBack()
  // pops it and reactivates that path (reopening its tab if it was closed
  // in the meantime). skipHistoryRef suppresses the push goBack's own
  // setActivePath would otherwise cause.
  const [backStack, setBackStack] = useState<string[]>([]);
  const prevActivePathRef = useRef<string | null>(null);
  const skipHistoryRef = useRef(false);
  useEffect(() => {
    const prev = prevActivePathRef.current;
    if (prev !== null && prev !== activePath && !skipHistoryRef.current) {
      setBackStack((stack) => [...stack, prev]);
    }
    skipHistoryRef.current = false;
    prevActivePathRef.current = activePath;
  }, [activePath]);

  const goBack = () => {
    setBackStack((stack) => {
      if (stack.length === 0) return stack;
      const target = stack[stack.length - 1]!;
      skipHistoryRef.current = true;
      setOpenPaths((prevPaths) => (prevPaths.includes(target) ? prevPaths : [...prevPaths, target]));
      setActivePath(target);
      return stack.slice(0, -1);
    });
  };

  // notes/ may not exist yet on a project that's never used Documents before.
  useEffect(() => {
    (async () => {
      try {
        await call<FsListResult>("fs.list", { relativePath: NOTES_ROOT });
      } catch {
        await call("fs.mkdir", { relativePath: NOTES_ROOT }).catch(() => undefined);
      }
      setReady(true);
    })();
  }, [call]);

  // Restore which tabs were open (and which was active) from the last
  // session — content is never persisted, only the set of open paths.
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    void window.yggdrasil.documents.getLayout().then((layout) => {
      setOpenPaths(layout.openPaths);
      setActivePath(layout.activePath);
    });
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void window.yggdrasil.documents.saveLayout({ openPaths, activePath });
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [openPaths, activePath]);

  const loadTab = useCallback(
    async (path: string) => {
      // Non-text kinds (image/pdf/binary) are rendered by FileViewer, which
      // does its own fs.readBinary fetch — reading them here via fs.read
      // (utf8-decoded) would just corrupt the bytes for no reason.
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

  // Load content for the active tab (and any restored tab as it becomes
  // active) the first time it's needed, rather than eagerly for every
  // restored tab on mount.
  useEffect(() => {
    if (activePath && !tabs[activePath]) void loadTab(activePath);
  }, [activePath, tabs, loadTab]);

  // An agent (or anything else) can edit a note that's open in a tab. Without
  // this the tab kept showing stale text and a later Ctrl+S overwrote the
  // edit. Clean tabs reload in place; a tab with unsaved edits keeps them and
  // shows a banner (see diskConflict) so neither side is lost silently.
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
      // Keep mine: adopt the disk version as the "saved" baseline so the tab
      // stays dirty and the next Ctrl+S deliberately overwrites it.
      return {
        ...prev,
        [path]: keepMine
          ? { ...tab, savedContent: disk, diskConflict: undefined }
          : { ...tab, content: disk, savedContent: disk, diskConflict: undefined },
      };
    });

  // "New feature doc": inline title input (Electron has no window.prompt) ->
  // notes/features/<slug>.md from the template, opened in a tab. An existing
  // doc with the same slug is opened as is, never overwritten.
  const [newDocTitle, setNewDocTitle] = useState<string | null>(null);
  const [newDocError, setNewDocError] = useState<string | null>(null);
  const createFeatureDoc = async () => {
    const title = (newDocTitle ?? "").trim();
    const path = featureDocPath(title);
    if (!path) {
      setNewDocError(t("docs.view.titleRequired"));
      return;
    }
    try {
      const exists = await call<FsReadResult>("fs.read", { relativePath: path }).then(
        () => true,
        () => false,
      );
      if (!exists) {
        await call("fs.mkdir", { relativePath: FEATURES_DIR }).catch(() => undefined);
        await call("fs.write", { relativePath: path, content: buildFeatureDoc(title) });
      }
      setNewDocTitle(null);
      setNewDocError(null);
      openFile(path);
    } catch (err) {
      setNewDocError(err instanceof Error ? err.message : String(err));
    }
  };

  // A note opened from a search hit also remembers what to show once it is on screen.
  const [reveal, setReveal] = useState<(RevealTarget & { path: string }) | null>(null);
  const openFile = (path: string, target?: OpenTarget) => {
    setOpenPaths((prev) => (prev.includes(path) ? prev : [...prev, path]));
    setActivePath(path);
    if (target) setReveal({ path, query: target.query, line: target.line, nonce: Date.now() });
  };

  // A file-path link clicked in a terminal pane (TerminalPane's
  // PathLinkProvider) opens here instead of falling through to the OS,
  // which has no app association for a bare project-relative path anyway.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => onRequestOpenDocument(openFile), []);

  // Reads the tab from the ref, not from a render's closure: autosave fires from timers and
  // blur handlers that would otherwise hold an older copy of what the user typed.
  const save = useCallback(
    async (path: string) => {
      const tab = tabsRef.current[path];
      // A truncated read is a partial file — writing it back would silently
      // drop the rest on disk, so this never saves one (the editor below is
      // also readOnly whenever truncated, but this is the backstop that
      // actually prevents data loss if that ever stops being true).
      if (!tab || tab.content === tab.savedContent || previewKind(path) !== "text" || tab.truncated) return;
      const written = tab.content;
      setTabs((prev) => (prev[path] ? { ...prev, [path]: { ...prev[path]!, saveState: "saving", saveError: undefined } } : prev));
      try {
        await call("fs.write", { relativePath: path, content: written });
        setTabs((prev) =>
          prev[path]
            ? { ...prev, [path]: { ...prev[path]!, savedContent: written, diskConflict: undefined, saveState: "saved", saveError: undefined } }
            : prev,
        );
      } catch (err) {
        setTabs((prev) =>
          prev[path]
            ? {
                ...prev,
                [path]: { ...prev[path]!, saveState: "error", saveError: err instanceof Error ? err.message : String(err) },
              }
            : prev,
        );
      }
    },
    [call],
  );

  // Autosave: a moment after the last keystroke the active note is written. The timer restarts
  // on every edit, so a note is only saved while the user pauses.
  const activeContent = activePath ? tabs[activePath]?.content : undefined;
  useEffect(() => {
    if (!activePath || !shouldAutosave(tabsRef.current[activePath])) return;
    const timer = setTimeout(() => void save(activePath), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [activePath, activeContent, save]);

  // Leaving a note (another tab, or the app losing focus) writes pending edits right away
  // instead of waiting out the delay.
  const flushedPathRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = flushedPathRef.current;
    flushedPathRef.current = activePath;
    if (prev && prev !== activePath && shouldAutosave(tabsRef.current[prev])) void save(prev);
  }, [activePath, save]);
  useEffect(() => {
    const flush = () => {
      if (activePath && shouldAutosave(tabsRef.current[activePath])) void save(activePath);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("blur", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [activePath, save]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (activePath) void save(activePath);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activePath, save]);

  const closeTab = (path: string) => {
    const tab = tabs[path];
    if (tab && tab.content !== tab.savedContent) {
      // Pending edits are written on the way out; only a note that can't be saved (a conflict
      // with the disk, a failed write) still asks before throwing them away.
      if (shouldAutosave(tab)) void save(path);
      else if (!window.confirm(t("doc.discardConfirmFile", { name: basename(path) }))) return;
    }
    releaseModel(path);
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

  // Shared by the tab context menu's "Close tabs to the right"/"Close all" —
  // each path still goes through closeTab's own per-file dirty confirm, so
  // this is never a silent bulk-discard, just several of the same prompt in
  // a row when more than one of the targeted tabs is actually unsaved.
  const closeMany = (paths: string[]) => {
    for (const path of paths) closeTab(path);
  };

  const [tabMenu, setTabMenu] = useState<{ path: string; x: number; y: number } | null>(null);

  const shareToDrive = useCallback(
    async (path: string) => {
      setDriveShares((prev) => ({ ...prev, [path]: { loading: true, error: null, webViewLink: null } }));
      try {
        const res = await call<{ webViewLink: string }>("documents.uploadToDrive", { path });
        setDriveShares((prev) => ({ ...prev, [path]: { loading: false, error: null, webViewLink: res.webViewLink } }));
      } catch (err) {
        setDriveShares((prev) => ({
          ...prev,
          [path]: { loading: false, error: err instanceof Error ? err.message : String(err), webViewLink: null },
        }));
      }
    },
    [call],
  );

  const notesIndexItems = useMemo(() => wikiItems(notesIndex, activePath ?? undefined), [notesIndex, activePath]);
  const activeBacklinks = useMemo(() => (activePath ? buildBacklinks(notesIndex, activePath) : []), [notesIndex, activePath]);

  const activeTab = activePath ? tabs[activePath] : undefined;
  const activeKind = activePath ? previewKind(activePath) : null;

  return (
    <div className="documents-view">
      <div className="documents-tree">
        {ready && (
          <div className="feature-doc-new">
            {newDocTitle === null ? (
              <button
                type="button"
                className="feature-doc-new-btn"
                title={t("docs.view.newFeatureDocTitle")}
                onClick={() => setNewDocTitle("")}
              >
                {t("docs.view.newFeatureDoc")}
              </button>
            ) : (
              <>
                <input
                  autoFocus
                  value={newDocTitle}
                  placeholder={t("docs.view.featureTitlePlaceholder")}
                  onChange={(e) => {
                    setNewDocTitle(e.target.value);
                    setNewDocError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void createFeatureDoc();
                    if (e.key === "Escape") {
                      setNewDocTitle(null);
                      setNewDocError(null);
                    }
                  }}
                  onBlur={() => {
                    if (!newDocTitle.trim()) setNewDocTitle(null);
                  }}
                />
                {newDocError && <span className="error">{newDocError}</span>}
              </>
            )}
          </div>
        )}
        {ready ? (
          <FileTree
            rootRelativePath={NOTES_ROOT}
            onOpenFile={openFile}
            activePath={activePath}
            searchable
            searchContent
            searchPlaceholder={t("docs.view.searchNotes")}
            shortcutPriority={1}
          />
        ) : (
          <p className="muted">{t("doc.loading")}</p>
        )}
      </div>
      <div className="documents-main">
        {openPaths.length > 0 && (
          <div className="documents-tabs">
            {openPaths.map((path) => {
              const dirty =
                previewKind(path) === "text" && tabs[path] && tabs[path]!.content !== tabs[path]!.savedContent;
              return (
                <div
                  key={path}
                  className={`documents-tab${path === activePath ? " active" : ""}`}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setTabMenu({ path, x: e.clientX, y: e.clientY });
                  }}
                >
                  <button type="button" className="documents-tab-label" onClick={() => setActivePath(path)} title={path}>
                    {dirty ? "● " : ""}
                    {basename(path)}
                  </button>
                  <button
                    type="button"
                    className="documents-tab-close"
                    title={t("doc.close")}
                    onClick={() => closeTab(path)}
                  >
                    <XMarkIcon className="hero-icon" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {(activePath || backStack.length > 0) && (
          <div className="documents-toolbar">
            <button
              type="button"
              className="icon-btn documents-back-btn"
              title={t("docs.view.back")}
              disabled={backStack.length === 0}
              onClick={goBack}
            >
              <ArrowLeftIcon className="hero-icon" />
            </button>
            {activePath && <Breadcrumb path={activePath} />}
            <span className="documents-toolbar-spacer" />
            {activePath && (
              <>
                <button
                  type="button"
                  className="documents-drive-share-btn"
                  disabled={driveShares[activePath]?.loading}
                  onClick={() => void shareToDrive(activePath)}
                >
                  {driveShares[activePath]?.loading ? t("docs.view.sharing") : t("docs.view.shareDrive")}
                </button>
                {driveShares[activePath]?.webViewLink && (
                  <a
                    className="documents-drive-link"
                    href={driveShares[activePath]!.webViewLink!}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("docs.view.openDrive")} <ArrowTopRightOnSquareIcon className="hero-icon" />
                  </a>
                )}
                {driveShares[activePath]?.error && (
                  <span className="error documents-drive-error">{driveShares[activePath]!.error}</span>
                )}
              </>
            )}
          </div>
        )}
        {activePath && activeKind === "text" && activeTab?.diskConflict !== undefined && (
          <DiskConflictBar
            onLoadDisk={() => resolveConflict(activePath, false)}
            onKeepMine={() => resolveConflict(activePath, true)}
          />
        )}
        {activePath && activeKind === "text" && /\.md$/i.test(activePath) && activeTab && !activeTab.loading && (
          <FeatureProgress content={activeTab.content} />
        )}
        <div className="documents-editor">
          {!activePath && <p className="muted documents-empty">{t("docs.view.selectNote")}</p>}
          {activePath && activeKind && activeKind !== "text" && <FileViewer relativePath={activePath} kind={activeKind} />}
          {activePath && activeKind === "text" && activeTab?.loading && (
            <p className="muted documents-empty">{t("doc.loading")}</p>
          )}
          {activePath && activeKind === "text" && activeTab?.error && (
            <p className="error documents-empty">{activeTab.error}</p>
          )}
          {activePath && activeKind === "text" && activeTab?.truncated && (
            <p className="muted documents-empty">
              {t("docs.view.truncated", {
                shown: activeTab.content.length.toLocaleString(),
                total: activeTab.totalLength?.toLocaleString() ?? "",
              })}
            </p>
          )}
          {activePath && activeKind === "text" && activeTab && !activeTab.loading && !activeTab.error && (
            <TextEditor
              path={activePath}
              value={activeTab.content}
              readOnly={activeTab.truncated}
              status={<SaveIndicator status={saveStatus(activeTab)} onRetry={() => void save(activePath)} />}
              reveal={reveal && reveal.path === activePath ? reveal : undefined}
              wikiItems={notesIndexItems}
              backlinks={activeBacklinks}
              onOpenBacklink={(b) => openFile(b.path)}
              onChange={(value) =>
                setTabs((prev) => ({ ...prev, [activePath]: { ...prev[activePath]!, content: value } }))
              }
            />
          )}
        </div>
      </div>
      {tabMenu && (
        <DocumentsTabContextMenu
          x={tabMenu.x}
          y={tabMenu.y}
          hasOthersToRight={openPaths.indexOf(tabMenu.path) < openPaths.length - 1}
          onClose={() => setTabMenu(null)}
          onCloseTab={() => closeTab(tabMenu.path)}
          onCloseOthersToRight={() => closeMany(openPaths.slice(openPaths.indexOf(tabMenu.path) + 1))}
          onCloseAll={() => closeMany(openPaths)}
        />
      )}
    </div>
  );
}
