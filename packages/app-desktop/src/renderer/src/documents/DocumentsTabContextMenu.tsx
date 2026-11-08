import { useRef } from "react";
import { useDismiss } from "../ui/useDismiss.js";
import { useI18n } from "../i18n/index.js";

type Props = {
  x: number;
  y: number;
  onClose: () => void;
  onCloseTab: () => void;
  onCloseOthersToRight: () => void;
  onCloseAll: () => void;
  hasOthersToRight: boolean;
};

// Same positioned-popup pattern as SessionContextMenu/FileTreeContextMenu
// (click-outside/Escape to dismiss), just without their multi-mode
// rename/confirm state since every action here is a single click.
export function DocumentsTabContextMenu({
  x,
  y,
  onClose,
  onCloseTab,
  onCloseOthersToRight,
  onCloseAll,
  hasOthersToRight,
}: Props) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);

  useDismiss(ref, onClose);

  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };

  return (
    <div className="context-menu" ref={ref} style={{ left: x, top: y }}>
      <button type="button" className="context-menu-item" onClick={run(onCloseTab)}>
        {t("doc.close")}
      </button>
      <button type="button" className="context-menu-item" disabled={!hasOthersToRight} onClick={run(onCloseOthersToRight)}>
        {t("docs.tabMenu.closeRight")}
      </button>
      <button type="button" className="context-menu-item" onClick={run(onCloseAll)}>
        {t("docs.tabMenu.closeAll")}
      </button>
    </div>
  );
}
