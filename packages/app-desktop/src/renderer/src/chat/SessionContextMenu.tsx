import { useRef, useState, type KeyboardEvent } from "react";
import type { SessionInfo } from "../types.js";
import { useDismiss } from "../ui/useDismiss.js";
import { useI18n } from "../i18n/index.js";

type Mode = "menu" | "rename" | "confirm-delete";

type Props = {
  session: SessionInfo;
  x: number;
  y: number;
  onClose: () => void;
  onRename: (sessionKey: string, title: string) => void;
  onDelete: (sessionKey: string) => void;
};

export function SessionContextMenu({ session, x, y, onClose, onRename, onDelete }: Props) {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>("menu");
  const [renameValue, setRenameValue] = useState(session.title ?? session.sessionKey);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useDismiss(ref, onClose);

  const copyId = async () => {
    await navigator.clipboard.writeText(session.sessionKey);
    setCopied(true);
    setTimeout(onClose, 700);
  };

  const submitRename = () => {
    const title = renameValue.trim();
    if (title) onRename(session.sessionKey, title);
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
          <button type="button" className="context-menu-item" onClick={() => void copyId()}>
            {copied ? t("chat.sessionMenu.copied") : t("chat.sessionMenu.copyId")}
          </button>
          <button type="button" className="context-menu-item" onClick={() => setMode("rename")}>
            {t("chat.sessionMenu.rename")}
          </button>
          <button
            type="button"
            className="context-menu-item danger"
            onClick={() => setMode("confirm-delete")}
          >
            {t("chat.sessionMenu.delete")}
          </button>
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

      {mode === "confirm-delete" && (
        <>
          <div className="context-menu-confirm-label">{t("chat.sessionMenu.confirmLabel")}</div>
          <button
            type="button"
            className="context-menu-item danger"
            onClick={() => {
              onDelete(session.sessionKey);
              onClose();
            }}
          >
            {t("chat.sessionMenu.confirmDelete")}
          </button>
          <button type="button" className="context-menu-item" onClick={() => setMode("menu")}>
            {t("chat.sessionMenu.cancel")}
          </button>
        </>
      )}
    </div>
  );
}
