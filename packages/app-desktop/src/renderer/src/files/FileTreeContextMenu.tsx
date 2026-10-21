import { useRef, useState, type KeyboardEvent } from "react";
import { useDismiss } from "../ui/useDismiss.js";

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
}: Props) {
  const [mode, setMode] = useState<Mode>("menu");
  const [inputValue, setInputValue] = useState(name);
  const ref = useRef<HTMLDivElement>(null);

  useDismiss(ref, onClose);

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
    <div className="context-menu" ref={ref} style={{ left: x, top: y }}>
      {mode === "menu" && (
        <>
          <button type="button" className="context-menu-item" onClick={() => setMode("rename")}>
            Rename
          </button>
          {onNewFile && (
            <button
              type="button"
              className="context-menu-item"
              onClick={() => {
                setInputValue("");
                setMode("new-file");
              }}
            >
              New file
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
              New folder
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
              Import files…
            </button>
          )}
          {onOpenInIde && (
            <button
              type="button"
              className="context-menu-item"
              onClick={() => {
                onOpenInIde();
                onClose();
              }}
            >
              Open in IDE
            </button>
          )}
          {onOpenInBlender && (
            <button
              type="button"
              className="context-menu-item"
              onClick={() => {
                onOpenInBlender();
                onClose();
              }}
            >
              Open in Blender
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
              Open in file explorer
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
              Compartir…
            </button>
          )}
          <button type="button" className="context-menu-item danger" onClick={() => setMode("confirm-delete")}>
            Delete
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
          placeholder={mode === "new-file" ? "file name" : mode === "new-folder" ? "folder name" : undefined}
          autoFocus
        />
      )}

      {mode === "confirm-delete" && (
        <>
          <div className="context-menu-confirm-label">
            {isDir ? `Delete "${name}" and everything inside it?` : `Delete "${name}"?`}
          </div>
          <button
            type="button"
            className="context-menu-item danger"
            onClick={() => {
              onDelete();
              onClose();
            }}
          >
            Confirm delete
          </button>
          <button type="button" className="context-menu-item" onClick={() => setMode("menu")}>
            Cancel
          </button>
        </>
      )}
    </div>
  );
}
