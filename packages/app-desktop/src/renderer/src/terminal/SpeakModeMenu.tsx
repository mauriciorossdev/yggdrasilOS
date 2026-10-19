import { useEffect, useRef } from "react";
import type { SpeakMode } from "./useSpeakLastResponse.js";

type Props = {
  x: number;
  y: number;
  onClose: () => void;
  onPick: (mode: SpeakMode) => void;
};

// Same positioned-popup pattern as DocumentsTabContextMenu/SessionContextMenu
// (click-outside/Escape to dismiss) — the terminal pane's speak button opens
// this instead of speaking immediately, so the user picks resumen vs todo
// per click.
export function SpeakModeMenu({ x, y, onClose, onPick }: Props) {
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

  const pick = (mode: SpeakMode) => () => {
    onPick(mode);
    onClose();
  };

  return (
    <div className="context-menu" ref={ref} style={{ left: x, top: y }}>
      <button type="button" className="context-menu-item" onClick={pick("summary")}>
        Resumen
      </button>
      <button type="button" className="context-menu-item" onClick={pick("full")}>
        Todo
      </button>
    </div>
  );
}
