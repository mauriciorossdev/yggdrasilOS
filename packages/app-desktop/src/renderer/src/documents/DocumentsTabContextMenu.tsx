import { useEffect, useRef } from "react";

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

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

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
