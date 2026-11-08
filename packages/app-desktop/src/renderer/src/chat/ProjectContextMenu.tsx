import { useRef, useState, type KeyboardEvent } from "react";
import type { ProjectRecord } from "../types.js";
import { useDismiss } from "../ui/useDismiss.js";
import { useI18n } from "../i18n/index.js";

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

const REVEAL_KEY = window.yggdrasil.platform === "darwin" ? "chat.projectMenu.revealFinder" : "chat.projectMenu.revealExplorer";

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
  const { t } = useI18n();
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
            {t("chat.projectMenu.open")}
          </button>
          <button type="button" className="context-menu-item" onClick={() => run(onReveal)}>
            {t(REVEAL_KEY)}
          </button>
          <button type="button" className="context-menu-item" onClick={() => run(onOpenInIde)}>
            {t("chat.projectMenu.openInIde")}
          </button>
          <button type="button" className="context-menu-item" onClick={() => run(onClone)}>
            {t("chat.projectMenu.clone")}
          </button>
          <button type="button" className="context-menu-item" onClick={() => setMode("rename")}>
            {t("chat.projectMenu.rename")}
          </button>
          {!locked && (
            <>
              <button type="button" className="context-menu-item danger" onClick={() => setMode("confirm-remove")}>
                {t("chat.projectMenu.remove")}
              </button>
              <button type="button" className="context-menu-item danger" onClick={() => setMode("confirm-purge")}>
                {t("chat.projectMenu.purge")}
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
          <div className="context-menu-confirm-label">{t("chat.projectMenu.confirmRemoveLabel", { name: project.name })}</div>
          <button type="button" className="context-menu-item danger" onClick={() => run(onRemove)}>
            {t("chat.projectMenu.confirmRemove")}
          </button>
          <button type="button" className="context-menu-item" onClick={() => setMode("menu")}>
            {t("chat.projectMenu.cancel")}
          </button>
        </>
      )}

      {mode === "confirm-purge" && (
        <>
          <div className="context-menu-confirm-label">
            {t("chat.projectMenu.confirmPurgeLabel", { name: project.name, path: project.path })}
          </div>
          <button type="button" className="context-menu-item danger" onClick={() => run(onPurge)}>
            {t("chat.projectMenu.confirmPurge")}
          </button>
          <button type="button" className="context-menu-item" onClick={() => setMode("menu")}>
            {t("chat.projectMenu.cancel")}
          </button>
        </>
      )}
    </div>
  );
}
