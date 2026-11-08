import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { branchRemoteTarget, branchUrl, compareUrl, remoteWeb } from "./branchUrl.js";
import type { BranchInfo, RemoteInfo } from "./types.js";
import { useDismiss } from "../ui/useDismiss.js";
import { useI18n } from "../i18n/index.js";

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
  const { t } = useI18n();
  const [mode, setMode] = useState<"menu" | "create">("menu");
  const [name, setName] = useState("");
  const [pos, setPos] = useState({ left: x, top: y });
  const ref = useRef<HTMLDivElement>(null);

  useDismiss(ref, onClose);

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
      ? t("repo.menu.noRemotes")
      : t("repo.menu.notPublished")
    : !web
      ? t("repo.menu.unknownRemote")
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
            {branch.remote ? t("repo.menu.checkoutRemote") : t("repo.menu.checkout")}
          </button>
          <button type="button" className="context-menu-item" disabled={disabled} onClick={() => setMode("create")}>
            {t("repo.menu.createFrom")}
          </button>
          <div className="context-menu-separator" />
          <button
            type="button"
            className="context-menu-item"
            disabled={!web || !target}
            title={linkReason}
            onClick={web && target ? open(branchUrl(web, target.branch)) : undefined}
          >
            {t("repo.menu.openBrowser")}
          </button>
          <button
            type="button"
            className="context-menu-item"
            disabled={!web || !target}
            title={linkReason}
            onClick={web && target ? open(compareUrl(web, target.branch)) : undefined}
          >
            {t("repo.menu.createPr")}
          </button>
          <button type="button" className="context-menu-item" onClick={act(() => void navigator.clipboard?.writeText(branch.name))}>
            {t("repo.menu.copyName")}
          </button>
          <div className="context-menu-separator" />
          <button type="button" className="context-menu-item" disabled={disabled || isCurrent || !currentBranch} onClick={act(onMerge)}>
            {currentBranch ? t("repo.menu.mergeInto", { branch: currentBranch }) : t("repo.menu.mergeIntoCurrent")}
          </button>
          {!branch.remote && (
            <button type="button" className="context-menu-item" disabled={disabled} onClick={act(onPush)}>
              {branch.upstream ? "Push" : t("repo.menu.publish")}
            </button>
          )}
          {isCurrent && (
            <button type="button" className="context-menu-item" disabled={disabled || !branch.upstream} title={branch.upstream ? undefined : t("repo.menu.noUpstream")} onClick={act(onPull)}>
              Pull
            </button>
          )}
          {!branch.remote && (
            <>
              <div className="context-menu-separator" />
              <button type="button" className="context-menu-item danger" disabled={disabled || isCurrent} onClick={act(onDelete)}>
                {t("repo.menu.delete")}
              </button>
            </>
          )}
        </>
      )}
      {mode === "create" && (
        <>
          <div className="context-menu-confirm-label">{t("repo.menu.newFrom", { branch: branch.name })}</div>
          <input
            className="context-menu-input"
            autoFocus
            placeholder={t("repo.menu.namePlaceholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={onInputKey}
          />
          <button type="button" className="context-menu-item" disabled={!name.trim()} onClick={submit}>
            {t("repo.menu.createSwitch")}
          </button>
        </>
      )}
    </div>
  );
}
