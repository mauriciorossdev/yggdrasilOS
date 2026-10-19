import { useEffect, useRef } from "react";
import type { PluginRecord } from "../types.js";

type Props = {
  plugin: PluginRecord;
  x: number;
  y: number;
  onClose: () => void;
  onOpenTab: () => void;
  onOpenPanel: () => void;
  onReload: () => void;
  onReveal: () => void;
  onShare?: () => void;
};

/** Same outside-click/Escape-to-close shell as SessionContextMenu.tsx, no rename/delete — a complemento's identity lives in its own manifest.json, not something this menu edits. */
export function PluginContextMenu({ plugin, x, y, onClose, onOpenTab, onOpenPanel, onReload, onReveal, onShare }: Props) {
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

  const views = plugin.manifest.views ?? [];

  return (
    <div className="context-menu" ref={ref} style={{ left: x, top: y }}>
      <button
        type="button"
        className="context-menu-item"
        disabled={!views.includes("tab")}
        onClick={() => {
          onOpenTab();
          onClose();
        }}
      >
        Abrir como pestaña
      </button>
      <button
        type="button"
        className="context-menu-item"
        disabled={!views.includes("panel")}
        onClick={() => {
          onOpenPanel();
          onClose();
        }}
      >
        Abrir como panel
      </button>
      <button
        type="button"
        className="context-menu-item"
        onClick={() => {
          onReload();
          onClose();
        }}
      >
        Recargar
      </button>
      <button
        type="button"
        className="context-menu-item"
        onClick={() => {
          onReveal();
          onClose();
        }}
      >
        Mostrar carpeta
      </button>
      {onShare && (
        <button
          type="button"
          className="context-menu-item"
          onClick={() => {
            onShare();
            onClose();
          }}
        >
          Compartir tablero…
        </button>
      )}
    </div>
  );
}
