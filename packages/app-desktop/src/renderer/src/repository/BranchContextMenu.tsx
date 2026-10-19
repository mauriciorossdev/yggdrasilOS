import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { branchRemoteTarget, branchUrl, compareUrl, remoteWeb } from "./branchUrl.js";
import type { BranchInfo, RemoteInfo } from "./types.js";

type Props = {
  x: number;
  y: number;
  branch: BranchInfo;
  /** Name of the checked-out branch (undefined when detached). */
  currentBranch?: string;
  remotes: RemoteInfo[];
  disabled: boolean;
  onClose: () => void;
  onCheckout: () => void;
  onCreateFrom: (newName: string) => void;
  onMerge: () => void;
  onPush: () => void;
  onPull: () => void;
  onDelete: () => void;
};

// Same positioned-popup/outside-click/Escape pattern as FileTreeContextMenu.tsx
// (incl. an inline <input> rather than window.prompt — Electron's renderer
// doesn't implement prompt()).
export function BranchContextMenu({ x, y, branch, currentBranch, remotes, disabled, onClose, onCheckout, onCreateFrom, onMerge, onPush, onPull, onDelete }: Props) {
  const [mode, setMode] = useState<"menu" | "create">("menu");
  const [name, setName] = useState("");
  const [pos, setPos] = useState({ left: x, top: y });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Keep the menu on screen (the rail is at the left edge but the bottom is easy to overflow).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)),
    });
  }, [x, y, mode]);

  const isCurrent = !branch.remote && branch.name === currentBranch;
  const target = branchRemoteTarget(branch, remotes);
  const web = target ? remoteWeb(target.remote.url) : null;
  const linkReason = !target
    ? remotes.length === 0
      ? "Este repositorio no tiene remotos"
      : "La rama no está publicada (sin upstream)"
    : !web
      ? "Remoto no reconocido (solo GitHub, GitLab y Bitbucket)"
      : undefined;

  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };
  const open = (url: string) => () => {
    window.open(url, "_blank", "noopener");
    onClose();
  };

  const submit = () => {
    const value = name.trim();
    if (value) onCreateFrom(value);
    onClose();
  };
  const onInputKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="context-menu" ref={ref} style={pos}>
      {mode === "menu" && (
        <>
          <button type="button" className="context-menu-item" disabled={disabled || isCurrent} onClick={act(onCheckout)}>
            {branch.remote ? "Cambiar a esta rama (crear local)" : "Cambiar a esta rama"}
          </button>
          <button type="button" className="context-menu-item" disabled={disabled} onClick={() => setMode("create")}>
            Crear rama desde aquí…
          </button>
          <div className="context-menu-separator" />
          <button
            type="button"
            className="context-menu-item"
            disabled={!web || !target}
            title={linkReason}
            onClick={web && target ? open(branchUrl(web, target.branch)) : undefined}
          >
            Abrir en el navegador
          </button>
          <button
            type="button"
            className="context-menu-item"
            disabled={!web || !target}
            title={linkReason}
            onClick={web && target ? open(compareUrl(web, target.branch)) : undefined}
          >
            Crear PR / MR…
          </button>
          <button type="button" className="context-menu-item" onClick={act(() => void navigator.clipboard?.writeText(branch.name))}>
            Copiar nombre de la rama
          </button>
          <div className="context-menu-separator" />
          <button type="button" className="context-menu-item" disabled={disabled || isCurrent || !currentBranch} onClick={act(onMerge)}>
            {currentBranch ? `Merge en "${currentBranch}"` : "Merge en la actual"}
          </button>
          {!branch.remote && (
            <button type="button" className="context-menu-item" disabled={disabled} onClick={act(onPush)}>
              {branch.upstream ? "Push" : "Publicar (push -u)"}
            </button>
          )}
          {isCurrent && (
            <button type="button" className="context-menu-item" disabled={disabled || !branch.upstream} title={branch.upstream ? undefined : "Sin upstream"} onClick={act(onPull)}>
              Pull
            </button>
          )}
          {!branch.remote && (
            <>
              <div className="context-menu-separator" />
              <button type="button" className="context-menu-item danger" disabled={disabled || isCurrent} onClick={act(onDelete)}>
                Borrar rama…
              </button>
            </>
          )}
        </>
      )}
      {mode === "create" && (
        <>
          <div className="context-menu-confirm-label">Nueva rama desde “{branch.name}” (y cambiar a ella)</div>
          <input
            className="context-menu-input"
            autoFocus
            placeholder="nombre-de-la-rama"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={onInputKey}
          />
          <button type="button" className="context-menu-item" disabled={!name.trim()} onClick={submit}>
            Crear y cambiar
          </button>
        </>
      )}
    </div>
  );
}
