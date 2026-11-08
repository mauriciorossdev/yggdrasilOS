import { useCallback, useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { ArrowDownTrayIcon, DocumentPlusIcon, FolderPlusIcon, MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/20/solid";
import { useGateway } from "@yggdrasil/client-web";
import { FileTreeNode } from "./FileTreeNode.js";
import type { FsEntry, FsListResult } from "../types.js";
import { FILE_DRAG_MIME, type FileDragPayload } from "./dragMimeType.js";
import { isSameOrDescendant, moveTargetPath } from "./fileTreeDnd.js";
import { sortEntries } from "./fileKinds.js";
import type { GitDecor } from "./gitDecor.js";
import { FileSearchResults, type OpenTarget } from "./FileSearchResults.js";
import { pickFilterBox, type FilterBox } from "./filterShortcut.js";
import { useI18n } from "../i18n/index.js";

type Props = {
  /** `target` is set when the file was opened from a content-search hit: where to take the reader. */
  onOpenFile: (relativePath: string, target?: OpenTarget) => void;
  /** Scopes the whole tree to a subfolder (e.g. "notes" for the Documents tab) instead of the project root. */
  rootRelativePath?: string;
  /** The currently-active tab in whatever's showing this tree (DocumentsView) — highlights the matching node, see FileTreeNode. */
  activePath?: string | null;
  /** git status shown on rows (letters on files, dots on folders); omitted = no decoration. */
  gitDecor?: GitDecor;
  /** Adds a filter box to the toolbar; while it has text the tree is replaced by a flat list of matching files. */
  searchable?: boolean;
  /** With `searchable`: also search what the files say, showing a snippet of each hit (names only otherwise). */
  searchContent?: boolean;
  /** Text of the filter box. */
  searchPlaceholder?: string;
  /** ⌘P goes to the visible filter box with the highest priority (the Documents tree outranks the sidebar's). */
  shortcutPriority?: number;
  /** Extra controls at the end of the toolbar (the sidebar's "index project" button). */
  toolbarEnd?: ReactNode;
};

function joinPath(root: string, name: string): string {
  return root ? `${root}/${name}` : name;
}

const IS_MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

// Every tab stays mounted, so the sidebar's tree and the Documents tree can both have a filter box.
type RegisteredFilter = { id: number; priority: number; input: () => HTMLInputElement | null };
const registeredFilters = new Set<RegisteredFilter>();
let nextFilterId = 0;

function focusShortcutTarget(): boolean {
  const entries = [...registeredFilters];
  const boxes: FilterBox[] = entries.map((e) => ({ id: e.id, priority: e.priority, visible: !!e.input()?.offsetParent }));
  const winner = entries.find((e) => e.id === pickFilterBox(boxes));
  const input = winner?.input();
  if (!input) return false;
  input.focus();
  input.select();
  return true;
}

export function FileTree({
  onOpenFile,
  rootRelativePath = "",
  activePath,
  gitDecor,
  searchable,
  searchContent,
  searchPlaceholder,
  shortcutPriority = 0,
  toolbarEnd,
}: Props) {
  const { t } = useI18n();
  const { call, onEvent, authenticated } = useGateway();
  const [entries, setEntries] = useState<FsEntry[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped on every drag-and-drop move anywhere in this tree — passed down
  // to every FileTreeNode so an already-expanded folder that gained/lost an
  // entry refetches in place (see FileTreeNode's own version effect).
  const [version, setVersion] = useState(0);
  const [rootDragOver, setRootDragOver] = useState(false);
  // Electron's renderer doesn't implement window.prompt() (only alert/
  // confirm) — it throws — so "new file/folder" needs its own inline input
  // instead of a native prompt dialog.
  const [creating, setCreating] = useState<"file" | "directory" | null>(null);
  const [creatingName, setCreatingName] = useState("");
  const [importing, setImporting] = useState(false);
  const [filter, setFilter] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);

  // ⌘P jumps to the filter box. Mac only: Ctrl+P is "previous command" in the shells running in the terminals.
  // One listener per tree, but only the highest-priority visible box answers (see focusShortcutTarget).
  useEffect(() => {
    if (!searchable || !IS_MAC) return;
    const entry: RegisteredFilter = { id: nextFilterId++, priority: shortcutPriority, input: () => filterRef.current };
    registeredFilters.add(entry);
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "p") {
        const winner = pickFilterBox(
          [...registeredFilters].map((f) => ({ id: f.id, priority: f.priority, visible: !!f.input()?.offsetParent })),
        );
        if (winner !== entry.id) return;
        e.preventDefault();
        focusShortcutTarget();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      registeredFilters.delete(entry);
    };
  }, [searchable, shortcutPriority]);

  const reload = useCallback(async () => {
    try {
      const res = await call<FsListResult>("fs.list", { relativePath: rootRelativePath });
      setEntries(res.entries);
      setTruncated(res.truncated ?? false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [call, rootRelativePath]);

  useEffect(() => {
    setEntries(null);
    setError(null);
  }, [rootRelativePath]);

  const onTreeChanged = useCallback(() => {
    setVersion((v) => v + 1);
    void reload();
  }, [reload]);

  // Keyed on `authenticated` too: after client-web auto-reconnects a
  // dropped gateway socket (gateway-client.ts) this refetches the root AND
  // bumps `version` so every still-expanded folder refetches in place —
  // otherwise a listing that failed while the socket was down ("Not
  // connected") stayed stuck on that error with nothing to retrigger it.
  useEffect(() => {
    if (!authenticated) return;
    onTreeChanged();
  }, [authenticated, onTreeChanged]);

  // fs-watch.ts (gateway) pushes this whenever a file/directory is added or
  // removed anywhere under the project root — an agent writing a file, a
  // `git pull`, an external editor. Without this, the tree only ever
  // refetches after a UI-driven change (create/import/DnD), so anything
  // added from outside stayed invisible until a manual collapse/expand.
  useEffect(() => onEvent((ev) => ev.event === "fs.changed" && onTreeChanged()), [onEvent, onTreeChanged]);

  // Shared by both the OS-file drag-drop path and the clipboard-paste path
  // below — `sourcePaths` are always real absolute filesystem paths by the
  // time this runs.
  const importPaths = useCallback(
    async (destRelativePath: string, sourcePaths: string[]) => {
      if (sourcePaths.length === 0) return;
      setImporting(true);
      try {
        const result = await window.yggdrasil.files.importExternal(destRelativePath, sourcePaths);
        // Refresh the listing (and any expanded folders, via version) BEFORE
        // setting the error — reload()'s own success path clears `error` to
        // null, which would otherwise wipe out an import error set right
        // before it (the error would flash and vanish within one tick).
        setVersion((v) => v + 1);
        await reload();
        if (result.errors.length > 0) setError(result.errors.join("; "));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setImporting(false);
      }
    },
    [reload],
  );

  const startCreating = (type: "file" | "directory") => {
    setCreatingName("");
    setCreating(type);
  };

  const submitCreating = async () => {
    const type = creating;
    const name = creatingName.trim();
    setCreating(null);
    if (!type || !name) return;
    const relativePath = joinPath(rootRelativePath, name);
    try {
      if (type === "file") await call("fs.write", { relativePath, content: "" });
      else await call("fs.mkdir", { relativePath });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const importAtRoot = async () => {
    const sourcePaths = await window.yggdrasil.files.pickToImport();
    await importPaths(rootRelativePath, sourcePaths);
  };

  const onCreatingKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void submitCreating();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setCreating(null);
    }
  };

  // Dropping on empty tree background (not on any row — rows swallow the
  // event themselves, see FileTreeNode) targets this tree's own root (e.g.
  // back to "notes/" directly) — either an internal move (our own
  // FILE_DRAG_MIME payload) or a real OS file/folder dragged in from
  // Finder/Explorer (e.dataTransfer.files — Electron stamps a real absolute
  // `.path` on those, unlike a clipboard paste of the same file, see
  // onTreeKeyDown below).
  const onRootDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(FILE_DRAG_MIME) && !e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = e.dataTransfer.types.includes("Files") ? "copy" : "move";
    setRootDragOver(true);
  };

  const onRootDragLeave = () => setRootDragOver(false);

  const onRootDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setRootDragOver(false);

    if (e.dataTransfer.files.length > 0) {
      const sourcePaths = Array.from(e.dataTransfer.files)
        .map((f) => window.yggdrasil.files.getPathForFile(f))
        .filter((p): p is string => !!p);
      await importPaths(rootRelativePath, sourcePaths);
      return;
    }

    const raw = e.dataTransfer.getData(FILE_DRAG_MIME);
    if (!raw) return;
    let payload: FileDragPayload;
    try {
      payload = JSON.parse(raw) as FileDragPayload;
    } catch {
      return;
    }
    const source = payload.relativePath;
    if (!source || isSameOrDescendant(rootRelativePath, source)) return;
    const to = moveTargetPath(source, rootRelativePath);
    if (to === source) return;
    try {
      await call("fs.rename", { fromRelativePath: source, toRelativePath: to });
      onTreeChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Best-effort fallback for files copied in Finder (Cmd+C there, Cmd+V
  // here) rather than dragged. Unreliable on macOS: for files in some
  // locations (observed with a PDF in ~/Downloads) Finder puts a
  // "file ID URL" (`file:///.file/id=...`) on the pasteboard instead of a
  // plain path — that scheme isn't resolvable through plain POSIX
  // stat/open (confirmed: ENOTDIR even from Node directly), only through
  // Cocoa APIs Electron doesn't expose. When that happens this silently
  // finds nothing. Dragging the file from Finder (onRootDrop/FileTreeNode's
  // onDrop above) is the reliable path — Electron resolves a real `.path`
  // for actual OS drags regardless of this quirk.
  const onTreeKeyDown = async (e: KeyboardEvent<HTMLDivElement>) => {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "v") return;
    e.preventDefault();
    const sourcePaths = await window.yggdrasil.clipboard.readFilePaths();
    await importPaths(rootRelativePath, sourcePaths);
  };

  return (
    <div
      className={`file-tree${rootDragOver ? " drag-over" : ""}`}
      tabIndex={0}
      onDragOver={onRootDragOver}
      onDragLeave={onRootDragLeave}
      onDrop={(e) => void onRootDrop(e)}
      onKeyDown={(e) => void onTreeKeyDown(e)}
    >
      {searchable && (
        <label className="file-tree-filter">
          <MagnifyingGlassIcon className="hero-icon" />
          <input
            ref={filterRef}
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setFilter("");
                e.currentTarget.blur();
              }
            }}
            placeholder={searchPlaceholder ?? t("doc.tree.filter")}
            aria-label={searchPlaceholder ?? t("doc.tree.filter")}
            autoComplete="off"
            spellCheck={false}
          />
          {filter ? (
            <button
              type="button"
              className="file-tree-filter-clear"
              title={t("doc.tree.clearFilter")}
              aria-label={t("doc.tree.clearFilter")}
              onClick={() => {
                setFilter("");
                filterRef.current?.focus();
              }}
            >
              <XMarkIcon className="hero-icon" />
            </button>
          ) : (
            IS_MAC && <kbd>⌘P</kbd>
          )}
        </label>
      )}
      <div className="file-tree-toolbar">
        <button type="button" className="icon-btn tip" data-tip={t("doc.tree.newFile")} aria-label={t("doc.tree.newFile")} onClick={() => startCreating("file")}>
          <DocumentPlusIcon className="hero-icon" />
        </button>
        <button type="button" className="icon-btn tip" data-tip={t("doc.tree.newFolder")} aria-label={t("doc.tree.newFolder")} onClick={() => startCreating("directory")}>
          <FolderPlusIcon className="hero-icon" />
        </button>
        <button type="button" className="icon-btn tip" data-tip={t("doc.tree.import")} aria-label={t("doc.tree.import")} onClick={() => void importAtRoot()}>
          <ArrowDownTrayIcon className="hero-icon" />
        </button>
        {toolbarEnd}
      </div>
      {creating && (
        <input
          className="context-menu-input file-tree-new-input"
          value={creatingName}
          onChange={(e) => setCreatingName(e.target.value)}
          onKeyDown={onCreatingKeyDown}
          onBlur={() => void submitCreating()}
          placeholder={creating === "file" ? t("doc.tree.fileName") : t("doc.tree.folderName")}
          autoFocus
        />
      )}
      {importing && <p className="muted">{t("doc.tree.importing")}</p>}
      {error && <p className="error">{error}</p>}
      {searchable && filter.trim() ? (
        <FileSearchResults query={filter.trim()} onOpenFile={onOpenFile} content={searchContent} root={rootRelativePath} />
      ) : (
        <>
          {!error && !entries && <p className="muted">{t("doc.loading")}</p>}
          {!error && entries?.length === 0 && <p className="muted">{t("doc.tree.empty")}</p>}
          {entries &&
            sortEntries(entries).map((entry) => (
              <FileTreeNode
                key={entry.name}
                entry={entry}
                relativePath={joinPath(rootRelativePath, entry.name)}
                depth={0}
                onOpenFile={onOpenFile}
                onRequestReload={reload}
                onTreeChanged={onTreeChanged}
                onImportPaths={importPaths}
                version={version}
                activePath={activePath}
                gitDecor={gitDecor}
              />
            ))}
        </>
      )}
      {truncated && !(searchable && filter.trim()) && <p className="muted">{t("doc.tree.more")}</p>}
    </div>
  );
}
