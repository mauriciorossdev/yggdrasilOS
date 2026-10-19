import { useEffect, useRef, useState } from "react";
import { ArrowsPointingInIcon, RectangleGroupIcon, Squares2X2Icon } from "@heroicons/react/20/solid";
import type { ArrangeLayout } from "./arrangeLayouts.js";
import type { RateLimitsPayload } from "../types.js";
import { CommandsMenu } from "./CommandsMenu.js";

type Props = {
  disabled: boolean;
  onArrange: (layout: ArrangeLayout) => void;
  viewMode: "grid" | "canvas";
  onToggleViewMode: () => void;
  onCompactAll: () => void;
  onSendCommand: (command: string) => void;
};

const OPTIONS: Array<{ layout: ArrangeLayout; label: string }> = [
  { layout: "row", label: "Row" },
  { layout: "2row", label: "2 Rows" },
  { layout: "2x2", label: "2×2" },
  { layout: "3x3", label: "3×3" },
  { layout: "auto", label: "Auto (orchestrator left)" },
];

function formatResetTime(resetsAt: number): string {
  return new Date(resetsAt * 1000).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Claude Code's own session (5h) / weekly (7d) rate-limit usage, sourced
 * from whichever `claude` pane last reported a status tick — see
 * statuslineBridge.ts and paneControlServer.ts's /statusline route. Self-
 * contained (owns its own IPC subscription) rather than threaded through as
 * a prop: this data is account-wide, not scoped to anything the rest of
 * TerminalContainer's state already tracks.
 */
function ClaudeUsage() {
  const [rateLimits, setRateLimits] = useState<RateLimitsPayload | undefined>();

  useEffect(() => {
    let cancelled = false;
    void window.yggdrasil.statusline.get().then((initial) => {
      if (!cancelled && initial) setRateLimits(initial);
    });
    const unsubscribe = window.yggdrasil.statusline.onUpdate((payload) => setRateLimits(payload));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  if (!rateLimits?.fiveHour && !rateLimits?.sevenDay) return null;

  const title = [
    rateLimits.fiveHour && `Session resets ${formatResetTime(rateLimits.fiveHour.resetsAt)}`,
    rateLimits.sevenDay && `Week resets ${formatResetTime(rateLimits.sevenDay.resetsAt)}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <span className="claude-usage" title={title}>
      {rateLimits.fiveHour && `5h ${Math.round(rateLimits.fiveHour.usedPercentage)}%`}
      {rateLimits.fiveHour && rateLimits.sevenDay && " · "}
      {rateLimits.sevenDay && `7d ${Math.round(rateLimits.sevenDay.usedPercentage)}%`}
    </span>
  );
}

/** Same click-outside/Escape-to-close pattern as ProjectContextMenu.tsx/FileTreeContextMenu.tsx, reusing the same .context-menu styling — a clickable dropdown, not a hover tooltip. */
export function TerminalNavbar({ disabled, onArrange, viewMode, onToggleViewMode, onCompactAll, onSendCommand }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="terminal-navbar" ref={ref}>
      {viewMode === "grid" && (
        <>
          <button
            type="button"
            className="icon-btn"
            title="Arrange terminals"
            disabled={disabled}
            onClick={() => setOpen((o) => !o)}
          >
            <Squares2X2Icon className="hero-icon" /> Arrange
          </button>
          {open && (
            <div className="context-menu terminal-arrange-menu">
              {OPTIONS.map((opt) => (
                <button
                  key={opt.layout}
                  type="button"
                  className="context-menu-item"
                  onClick={() => {
                    onArrange(opt.layout);
                    setOpen(false);
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      <button
        type="button"
        className={`icon-btn${viewMode === "canvas" ? " active" : ""}`}
        title={viewMode === "canvas" ? "Switch to grid view" : "Switch to canvas view"}
        disabled={disabled}
        onClick={onToggleViewMode}
      >
        <RectangleGroupIcon className="hero-icon" /> Canvas
      </button>
      <button
        type="button"
        className="icon-btn"
        title="Send /compact to every open pane"
        disabled={disabled}
        onClick={onCompactAll}
      >
        <ArrowsPointingInIcon className="hero-icon" /> Compact
      </button>
      <CommandsMenu disabled={disabled} onSelect={onSendCommand} />
      <ClaudeUsage />
    </div>
  );
}
