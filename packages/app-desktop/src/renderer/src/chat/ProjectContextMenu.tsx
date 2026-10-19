import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ProjectRecord } from "../types.js";

type Mode = "menu" | "rename";

type Props = {
  project: ProjectRecord;
  x: number;
  y: number;
  onClose: () => void;
  onRename: (id: string, name: string) => void;
};

export function ProjectContextMenu({ project, x, y, onClose, onRename }: Props) {
  const [mode, setMode] = useState<Mode>("menu");
  const [renameValue, setRenameValue] = useState(project.name);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const submitRename = () => {
    const name = renameValue.trim();
    if (name && name !== project.name) onRename(project.id, name);
    onClose();
  };

  const onRenameKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="context-menu" ref={ref} style={{ left: x, top: y }}>
      {mode === "menu" && (
        <button type="button" className="context-menu-item" onClick={() => setMode("rename")}>
          Rename
        </button>
      )}

      {mode === "rename" && (
        <input
          className="context-menu-input"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={onRenameKeyDown}
          onBlur={submitRename}
          autoFocus
        />
      )}
    </div>
  );
}
