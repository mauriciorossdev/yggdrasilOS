import { useCallback, useEffect, useRef, useState, type DragEvent, type MouseEvent } from "react";
import { ChevronRightIcon } from "@heroicons/react/20/solid";
import { useGateway } from "@yggdrasil/client-web";
import type { FsEntry, FsListResult } from "../types.js";
import { FILE_DRAG_MIME, type FileDragPayload } from "./dragMimeType.js";
import { FileTreeContextMenu } from "./FileTreeContextMenu.js";
import { isSameOrDescendant, moveTargetPath } from "./fileTreeDnd.js";
import { isBlenderFile } from "./filePreviewKind.js";
import { EntryIcon } from "./FileIcons.js";
import { isHiddenName, sortEntries } from "./fileKinds.js";
import type { GitDecor } from "./gitDecor.js";
import { quotePathForShell, type SendTarget } from "./sendTargets.js";
import { requestChatAttach } from "../chat/chatAttachBridge.js";
import { setActiveTab } from "../ui/mainTabsStore.js";
import { requestFocusPane } from "../terminal/terminalPanesStore.js";
import { ShareDialog } from "../sync/ShareDialog.js";
import { useI18n } from "../i18n/index.js";

type Props = {
  entry: FsEntry;
  relativePath: string;
  depth: number;
  onOpenFile: (relativePath: string) => void;
  /** Reload the listing this node lives in (the parent's children, or FileTree's root list) — used after this node itself is renamed/deleted. */
  onRequestReload: () => void;
  /** A drag-and-drop move happened anywhere in this tree — same callback reference passed unchanged at every depth (FileTree's own full-tree refresh), unlike onRequestReload which is level-specific. */
  onTreeChanged: () => void;
  /** Copy real OS files/folders (absolute paths) into a relativePath inside this tree — same reference at every depth, owned by FileTree. */
  onImportPaths: (destRelativePath: string, sourcePaths: string[]) => Promise<void>;
  /** Bumped by FileTree on every onTreeChanged — an already-expanded node refetches its children when this changes, without collapsing. */
  version: number;
  /** The Documents panel's currently-active tab (if any) — highlights the matching leaf and auto-expands any ancestor folder so it's visible without manually clicking through the tree. */
  activePath?: string | null;
  /** git status to show on rows (a letter on files, a dot on folders holding changes); omitted = no decoration. */
  gitDecor?: GitDecor;
};

export function FileTreeNode({
  entry,
  relativePath,
  depth,
  onOpenFile,
  onRequestReload,
  onTreeChanged,
  onImportPaths,
  version,
  activePath,
  gitDecor,
}: Props) {
  const { t } = useI18n();
  const { call } = useGateway();
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FsEntry[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [showShare, setShowShare] = useState(false);

  const isDir = entry.type === "directory";
  const indent = 6 + depth * 14;
  const isActive = !isDir && relativePath === activePath;
  const containsActive = isDir && !!activePath && activePath !== relativePath && isSameOrDescendant(activePath, relativePath);
  const rowRef = useRef<HTMLButtonElement>(null);
  const gitLetter = !isDir ? gitDecor?.files.get(relativePath) : undefined;
  const gitMark = gitLetter ? (
    <span className={`git-mark git-${gitLetter === "?" ? "U" : gitLetter === "!" ? "C" : gitLetter}`} title={t("doc.git.changes")}>
      {gitLetter}
    </span>
  ) : isDir && gitDecor?.dirs.has(relativePath) ? (
    <span className="git-dot" title={t("doc.git.dirChanges")} />
  ) : null;
  // Sharing is scoped to notes/ files specifically — see main/syncEngine.ts's
  // "notes-file" resource type, which only knows how to read/write inside a
  // project's notes/ folder (resolveWithinNotes).
  const isNotesFile = !isDir && (relativePath === "notes" ? false : relativePath.startsWith("notes/"));

  const loadChildren = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await call<FsListResult>("fs.list", { relativePath });
      setChildren(res.entries);
      setTruncated(res.truncated ?? false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [call, relativePath]);

  // A move elsewhere in the tree can add/remove entries from this
  // already-expanded folder — refresh in place, keep it expanded. Also
  // retries a load that errored (e.g. "Not connected" while the gateway
  // socket was down — FileTree bumps `version` on reconnect).
  useEffect(() => {
    if (children !== null || error) void loadChildren();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  // Reveals the active tab's file without the user manually clicking down
  // through every ancestor folder — only ever expands (never auto-collapses
  // when the active doc moves elsewhere), same as expanding it by hand.
  useEffect(() => {
    if (!containsActive || expanded) return;
    if (children === null && !loading) void loadChildren();
    setExpanded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containsActive]);

  useEffect(() => {
    if (isActive) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [isActive]);

  const toggle = async () => {
    if (!isDir) {
      onOpenFile(relativePath);
      return;
    }
    if (!expanded && children === null && !loading) await loadChildren();
    setExpanded((e) => !e);
  };

  const onDragStart = (e: DragEvent<HTMLButtonElement>) => {
    const payload: FileDragPayload = { relativePath, type: entry.type === "directory" ? "directory" : "file" };
    e.dataTransfer.setData(FILE_DRAG_MIME, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "copyMove";
  };

  // Every row swallows dragover/drop (preventDefault + stopPropagation)
  // regardless of type, so a drop on a file row (or a directory that
  // rejects the specific drag) doesn't fall through to FileTree's own
  // root-level handler and get misread as "move to tree root". Accepts both
  // our own internal FILE_DRAG_MIME payload (move) and a real OS file/folder
  // dragged in from Finder/Explorer ("Files" — Electron gives those a real
  // absolute `.path`, unlike a clipboard paste of the same file).
  const onDragOver = (e: DragEvent<HTMLButtonElement>) => {
    const isOsFile = e.dataTransfer.types.includes("Files");
    if (!e.dataTransfer.types.includes(FILE_DRAG_MIME) && !isOsFile) return;
    e.preventDefault();
    e.stopPropagation();
    if (isDir) {
      e.dataTransfer.dropEffect = isOsFile ? "copy" : "move";
      setDragOver(true);
    }
  };

  const onDragLeave = () => setDragOver(false);

  const onDrop = async (e: DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (!isDir) return;

    if (e.dataTransfer.files.length > 0) {
      const sourcePaths = Array.from(e.dataTransfer.files)
        .map((f) => window.yggdrasil.files.getPathForFile(f))
        .filter((p): p is string => !!p);
      setExpanded(true);
      await onImportPaths(relativePath, sourcePaths);
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
    if (!source || isSameOrDescendant(relativePath, source)) return;
    const to = moveTargetPath(source, relativePath);
    if (to === source) return;
    try {
      await call("fs.rename", { fromRelativePath: source, toRelativePath: to });
      setExpanded(true);
      onTreeChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onContextMenu = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const parentDir = relativePath.includes("/") ? relativePath.slice(0, relativePath.lastIndexOf("/")) : "";

  const rename = async (newName: string) => {
    const toRelativePath = parentDir ? `${parentDir}/${newName}` : newName;
    try {
      await call("fs.rename", { fromRelativePath: relativePath, toRelativePath });
      onRequestReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const remove = async () => {
    try {
      await call("fs.delete", { relativePath });
      onRequestReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const createChild = async (type: "file" | "directory", name: string) => {
    const childPath = `${relativePath}/${name}`;
    try {
      if (type === "file") await call("fs.write", { relativePath: childPath, content: "" });
      else await call("fs.mkdir", { relativePath: childPath });
      setExpanded(true);
      await loadChildren();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const importFiles = async () => {
    const sourcePaths = await window.yggdrasil.files.pickToImport();
    if (sourcePaths.length === 0) return;
    setExpanded(true);
    await onImportPaths(relativePath, sourcePaths);
  };

  // Mirrors TitleBar.tsx's openIde: `opened: false` means unconfigured or the
  // configured IDE vanished — surface the error (if any) and tell the user
  // where to configure it, same as the title bar button's fallback.
  const openInIde = async () => {
    const result = await window.yggdrasil.ide.openPath(relativePath);
    if (!result.opened) {
      window.alert(result.error ?? "No IDE configured yet. Set one in Settings → IDE.");
    }
  };

  const openInBlender = async () => {
    const result = await window.yggdrasil.ide.openInBlender(relativePath);
    if (!result.opened) window.alert(result.error ?? "Could not open Blender.");
  };

  const copyToClipboard = async () => {
    const result = await window.yggdrasil.clipboard.writeFilePaths([relativePath]);
    if (!result.ok) window.alert(result.error ?? "Could not copy to the clipboard.");
  };

  const copyPathText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not copy the path.");
    }
  };

  const copyAbsolutePath = async () => {
    try {
      await copyPathText(await window.yggdrasil.files.absolutePath(relativePath));
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not resolve the path.");
    }
  };

  const pasteHere = async () => {
    const sourcePaths = await window.yggdrasil.clipboard.readFilePaths();
    if (sourcePaths.length === 0) {
      window.alert(t("doc.tree.noClipboardFiles"));
      return;
    }
    setExpanded(true);
    await onImportPaths(relativePath, sourcePaths);
  };

  const openWithDefaultApp = async () => {
    try {
      await window.yggdrasil.files.openExternal(relativePath);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not open it with the default app.");
    }
  };

  // The chat takes it as an attachment on its pending message; a terminal gets the absolute
  // path typed in (no Enter, so the user decides what to do with it). Either way the user is
  // taken there: the text is waiting in that pane, the chip in that composer.
  const sendTo = async (target: SendTarget) => {
    if (target.kind === "chat") {
      if (requestChatAttach({ relativePath, type: isDir ? "directory" : "file" })) setActiveTab("chat");
      else window.alert(t("doc.tree.chatUnavailable"));
      return;
    }
    try {
      const absolute = await window.yggdrasil.files.absolutePath(relativePath);
      await window.yggdrasil.terminals.write(target.id, `${quotePathForShell(absolute, /Win/i.test(navigator.platform))} `);
      setActiveTab("terminal");
      requestFocusPane(target.id);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not send it to the terminal.");
    }
  };

  const revealInExplorer = async () => {
    const result = await window.yggdrasil.ide.revealPath(relativePath, isDir);
    if (!result.opened) window.alert(result.error ?? "Could not open the file explorer.");
  };

  return (
    <div className="file-node">
      <button
        ref={rowRef}
        type="button"
        className={`file-node-row ${!isDir ? "file-node-leaf" : ""}${dragOver ? " drag-over" : ""}${isActive ? " active" : ""}${isHiddenName(entry.name) ? " hidden-entry" : ""}`}
        style={{ paddingLeft: indent }}
        title={relativePath}
        onClick={() => void toggle()}
        onContextMenu={onContextMenu}
        draggable
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={(e) => void onDrop(e)}
      >
        {Array.from({ length: depth }, (_, i) => (
          <span key={i} className="file-node-guide" style={{ left: 13 + i * 14 }} aria-hidden="true" />
        ))}
        <span className={`chevron ${!isDir ? "chevron-hidden" : expanded ? "open" : ""}`}>
          <ChevronRightIcon className="hero-icon" />
        </span>
        <span className="file-node-icon">
          <EntryIcon name={entry.name} isDir={isDir} open={expanded} />
        </span>
        <span className="file-node-name">{entry.name}</span>
        {gitMark}
      </button>

      {menu && (
        <FileTreeContextMenu
          x={menu.x}
          y={menu.y}
          name={entry.name}
          isDir={isDir}
          onClose={() => setMenu(null)}
          onRename={(newName) => void rename(newName)}
          onDelete={() => void remove()}
          onNewFile={isDir ? (name) => void createChild("file", name) : undefined}
          onNewFolder={isDir ? (name) => void createChild("directory", name) : undefined}
          onImportFiles={isDir ? () => void importFiles() : undefined}
          onOpenInIde={() => void openInIde()}
          onOpenExternal={!isDir ? () => void openWithDefaultApp() : undefined}
          onCopy={() => void copyToClipboard()}
          onCopyPath={() => void copyAbsolutePath()}
          onCopyRelativePath={() => void copyPathText(relativePath)}
          onPaste={isDir ? () => void pasteHere() : undefined}
          onSendTo={(target) => void sendTo(target)}
          onReveal={() => void revealInExplorer()}
          onOpenInBlender={!isDir && isBlenderFile(relativePath) ? () => void openInBlender() : undefined}
          onShare={isNotesFile ? () => setShowShare(true) : undefined}
        />
      )}

      {showShare && window.yggdrasil.projectId && (
        <ShareDialog
          resourceRef={{ resourceType: "notes-file", projectId: window.yggdrasil.projectId, relativePath }}
          title={`Compartir "${entry.name}"`}
          onClose={() => setShowShare(false)}
        />
      )}

      {isDir && expanded && (
        <div className="file-node-children">
          {loading && (
            <div className="muted" style={{ paddingLeft: indent + 14 }}>
              {t("doc.loading")}
            </div>
          )}
          {error && (
            <div className="error" style={{ paddingLeft: indent + 14 }}>
              {error}
            </div>
          )}
          {children && sortEntries(children).map((child) => (
            <FileTreeNode
              key={child.name}
              entry={child}
              relativePath={relativePath ? `${relativePath}/${child.name}` : child.name}
              depth={depth + 1}
              onOpenFile={onOpenFile}
              onRequestReload={loadChildren}
              onTreeChanged={onTreeChanged}
              onImportPaths={onImportPaths}
              version={version}
              activePath={activePath}
              gitDecor={gitDecor}
            />
          ))}
          {truncated && (
            <div className="muted" style={{ paddingLeft: indent + 14 }}>
              …and more items not shown
            </div>
          )}
        </div>
      )}
    </div>
  );
}
