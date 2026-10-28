import { useRef, useState, type KeyboardEvent } from "react";
import type { ProjectRecord } from "../types.js";
import { useDismiss } from "../ui/useDismiss.js";

type Mode = "menu" | "rename" | "confirm-remove" | "confirm-purge";

type Props = {
  project: ProjectRecord;
  /** The default workspace and the project owning this very window can't be removed/purged — hides those two items. */
  locked: boolean;
  x: number;
  y: number;
  onClose: () => void;
  onOpen: (id: string) => void;
  onReveal: (id: string) => void;
  onOpenInIde: (id: string) => void;
  onClone: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
  onPurge: (id: string) => void;
};

const REVEAL_LABEL = window.yggdrasil.platform === "darwin" ? "Reveal in Finder" : "Open in file explorer";

export function ProjectContextMenu({
  project,
  locked,
  x,
  y,
  onClose,
  onOpen,
  onReveal,
  onOpenInIde,
  onClone,
  onRename,
  onRemove,
  onPurge,
}: Props) {
  const [mode, setMode] = useState<Mode>("menu");
  const [renameValue, setRenameValue] = useState(project.name);
  const ref = useRef<HTMLDivElement>(null);

  useDismiss(ref, onClose);

  const run = (action: (id: string) => void) => {
    action(project.id);
    onClose();
  };

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
        <>
          <button type="button" className="context-menu-item" onClick={() => run(onOpen)}>
            Open project
          </button>
          <button type="button" className="context-menu-item" onClick={() => run(onReveal)}>
            {REVEAL_LABEL}
          </button>
          <button type="button" className="context-menu-item" onClick={() => run(onOpenInIde)}>
            Open in IDE
          </button>
          <button type="button" className="context-menu-item" onClick={() => run(onClone)}>
            Clone…
          </button>
          <button type="button" className="context-menu-item" onClick={() => setMode("rename")}>
            Rename
          </button>
          {!locked && (
            <>
              <button type="button" className="context-menu-item danger" onClick={() => setMode("confirm-remove")}>
                Remove from list
              </button>
              <button type="button" className="context-menu-item danger" onClick={() => setMode("confirm-purge")}>
                Purge (delete from disk)
              </button>
            </>
          )}
        </>
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

      {mode === "confirm-remove" && (
        <>
          <div className="context-menu-confirm-label">Remove "{project.name}" from the list? Files stay on disk.</div>
          <button type="button" className="context-menu-item danger" onClick={() => run(onRemove)}>
            Confirm remove
          </button>
          <button type="button" className="context-menu-item" onClick={() => setMode("menu")}>
            Cancel
          </button>
        </>
      )}

      {mode === "confirm-purge" && (
        <>
          <div className="context-menu-confirm-label">
            Permanently delete "{project.name}" and its folder? {project.path} — this can't be undone.
          </div>
          <button type="button" className="context-menu-item danger" onClick={() => run(onPurge)}>
            Confirm purge
          </button>
          <button type="button" className="context-menu-item" onClick={() => setMode("menu")}>
            Cancel
          </button>
        </>
      )}
    </div>
  );
}
