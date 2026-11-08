import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useDismiss } from "../ui/useDismiss.js";
import { useActiveTab } from "../ui/mainTabsStore.js";
import { useTerminalPanes } from "../terminal/terminalPanesStore.js";
import { buildSendTargets, type SendTarget } from "./sendTargets.js";
import { useI18n } from "../i18n/index.js";

type Mode = "menu" | "rename" | "confirm-delete" | "new-file" | "new-folder";

type Props = {
  x: number;
  y: number;
  name: string;
  isDir: boolean;
  onClose: () => void;
  onRename: (newName: string) => void;
  onDelete: () => void;
  onNewFile?: (name: string) => void;
  onNewFolder?: (name: string) => void;
  onImportFiles?: () => void;
  onOpenInIde?: () => void;
  onReveal?: () => void;
  onOpenInBlender?: () => void;
  onShare?: () => void;
  /** Copy the file/folder to the OS clipboard. */
  onCopy?: () => void;
  /** Copy its absolute path / its path relative to the project, as text. */
  onCopyPath?: () => void;
  onCopyRelativePath?: () => void;
  /** Paste what is on the OS clipboard into this folder (folders only). */
  onPaste?: () => void;
  /** Open with whatever app the OS associates with it. */
  onOpenExternal?: () => void;
  /** Send to the chat or to an open terminal; the menu lists them and marks the one in focus. */
  onSendTo?: (target: SendTarget) => void;
};

// Mirrors ProjectContextMenu.tsx/SessionContextMenu.tsx's positioning/
// backdrop-close/mode pattern exactly, extended with New file/New folder
// (directories only). Every name-entry mode (rename/new-file/new-folder)
// uses an inline <input> rather than window.prompt() — Electron's renderer
// doesn't implement window.prompt() at all (only alert/confirm), it throws.
export function FileTreeContextMenu({
  x,
  y,
  name,
  isDir,
  onClose,
  onRename,
  onDelete,
  onNewFile,
  onNewFolder,
  onImportFiles,
  onOpenInIde,
  onReveal,
  onOpenInBlender,
  onShare,
  onCopy,
  onCopyPath,
  onCopyRelativePath,
  onPaste,
  onOpenExternal,
  onSendTo,
}: Props) {
  const { t: tr } = useI18n();
  const [mode, setMode] = useState<Mode>("menu");
  const [inputValue, setInputValue] = useState(name);
  const ref = useRef<HTMLDivElement>(null);

  useDismiss(ref, onClose);

  const { panes, activeId } = useTerminalPanes();
  const activeTab = useActiveTab();
  const sendTargets = onSendTo ? buildSendTargets(panes, activeId, activeTab) : [];

  // The menu grew taller than it used to be: keep it on screen near the bottom edge.
  const [top, setTop] = useState(y);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const overflow = y + el.offsetHeight + 8 - window.innerHeight;
    setTop(overflow > 0 ? Math.max(8, y - overflow) : y);
  }, [y, mode]);

  const item = (label: string, action: () => void, extra?: string) => (
    <button
      type="button"
      className="context-menu-item"
      onClick={() => {
        action();
        onClose();
      }}
    >
      {label}
      {extra && <span className="context-menu-badge">{extra}</span>}
    </button>
  );

  const submit = () => {
    const value = inputValue.trim();
    if (mode === "rename") {
      if (value && value !== name) onRename(value);
    } else if (mode === "new-file") {
      if (value) onNewFile?.(value);
    } else if (mode === "new-folder") {
      if (value) onNewFolder?.(value);
    }
    onClose();
  };

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="context-menu" ref={ref} style={{ left: x, top }}>
      {mode === "menu" && (
        <>
          <button type="button" className="context-menu-item" onClick={() => setMode("rename")}>
            {tr("doc.menu.rename")}
          </button>
          {onCopy && item(tr("doc.menu.copy"), onCopy)}
          {onCopyPath && item(tr("doc.menu.copyPath"), onCopyPath)}
          {onCopyRelativePath && item(tr("doc.menu.copyRelativePath"), onCopyRelativePath)}
          {onPaste && item(tr("doc.menu.paste"), onPaste)}
          {onNewFile && (
            <button
              type="button"
              className="context-menu-item"
              onClick={() => {
                setInputValue("");
                setMode("new-file");
              }}
            >
              {tr("doc.tree.newFile")}
            </button>
          )}
          {onNewFolder && (
            <button
              type="button"
              className="context-menu-item"
              onClick={() => {
                setInputValue("");
                setMode("new-folder");
              }}
            >
              {tr("doc.tree.newFolder")}
            </button>
          )}
          {onImportFiles && (
            <button
              type="button"
              className="context-menu-item"
              onClick={() => {
                onImportFiles();
                onClose();
              }}
            >
              {tr("doc.menu.import")}
            </button>
          )}
          {onSendTo && sendTargets.length > 0 && (
            <>
              <div className="context-menu-separator" />
              <div className="context-menu-label">{tr("doc.menu.sendTo")}</div>
              {sendTargets.map((target) => (
                <div key={target.kind === "chat" ? "chat" : target.id}>
                  {item(target.label, () => onSendTo(target), target.focused ? tr("doc.menu.focused") : undefined)}
                </div>
              ))}
              <div className="context-menu-separator" />
            </>
          )}
          {onOpenInIde && item(tr("doc.menu.openIde"), onOpenInIde)}
          {onOpenExternal && item(tr("doc.menu.openDefault"), onOpenExternal)}
          {onOpenInBlender && (
            <button
              type="button"
              className="context-menu-item"
              onClick={() => {
                onOpenInBlender();
                onClose();
              }}
            >
              {tr("doc.openBlender")}
            </button>
          )}
          {onReveal && (
            <button
              type="button"
              className="context-menu-item"
              onClick={() => {
                onReveal();
                onClose();
              }}
            >
              {tr("doc.menu.reveal")}
            </button>
          )}
          {onShare && (
            <button
              type="button"
              className="context-menu-item"
              onClick={() => {
                onShare();
                onClose();
              }}
            >
              {tr("doc.menu.share")}
            </button>
          )}
          <button type="button" className="context-menu-item danger" onClick={() => setMode("confirm-delete")}>
            {tr("doc.delete")}
          </button>
        </>
      )}

      {(mode === "rename" || mode === "new-file" || mode === "new-folder") && (
        <input
          className="context-menu-input"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={onInputKeyDown}
          onBlur={submit}
          placeholder={mode === "new-file" ? tr("doc.tree.fileName") : mode === "new-folder" ? tr("doc.tree.folderName") : undefined}
          autoFocus
        />
      )}

      {mode === "confirm-delete" && (
        <>
          <div className="context-menu-confirm-label">
            {isDir ? tr("doc.menu.confirmDeleteDir", { name }) : tr("doc.menu.confirmDelete", { name })}
          </div>
          <button
            type="button"
            className="context-menu-item danger"
            onClick={() => {
              onDelete();
              onClose();
            }}
          >
            {tr("doc.menu.confirmDeleteBtn")}
          </button>
          <button type="button" className="context-menu-item" onClick={() => setMode("menu")}>
            {tr("doc.cancel")}
          </button>
        </>
      )}
    </div>
  );
}
