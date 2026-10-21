import { useRef } from "react";
import { useDismiss } from "../ui/useDismiss.js";

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
  const ref = useRef<HTMLDivElement>(null);

  useDismiss(ref, onClose);

  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };

  return (
    <div className="context-menu" ref={ref} style={{ left: x, top: y }}>
      <button type="button" className="context-menu-item" onClick={run(onCloseTab)}>
        Close
      </button>
      <button type="button" className="context-menu-item" disabled={!hasOthersToRight} onClick={run(onCloseOthersToRight)}>
        Close tabs to the right
      </button>
      <button type="button" className="context-menu-item" onClick={run(onCloseAll)}>
        Close all
      </button>
    </div>
  );
}
