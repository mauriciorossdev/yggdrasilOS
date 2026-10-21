import { useEffect, useRef, useState } from "react";
import { ArrowsPointingInIcon, PlusIcon, RectangleGroupIcon, Squares2X2Icon } from "@heroicons/react/20/solid";
import type { ArrangeLayout } from "./arrangeLayouts.js";
import type { AgentTeam } from "../types.js";
import { onTerminalTabVisible, requestLoadTeam, requestNewTerminal } from "./terminalBridge.js";
import { TeamsMenu } from "./TeamsMenu.js";
import { CommandsMenu } from "./CommandsMenu.js";
import { useDismiss } from "../ui/useDismiss.js";

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

/** Same click-outside/Escape-to-close pattern as ProjectContextMenu.tsx/FileTreeContextMenu.tsx, reusing the same .context-menu styling — a clickable dropdown, not a hover tooltip. */
export function TerminalNavbar({ disabled, onArrange, viewMode, onToggleViewMode, onCompactAll, onSendCommand }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [teams, setTeams] = useState<AgentTeam[]>([]);

  useDismiss(ref, () => setOpen(false), open);

  // Saved teams: refetch whenever the Terminal tab becomes visible, in case one was just saved from Agent Flow.
  useEffect(() => {
    const load = () => void window.yggdrasil.agentTeams.list().then(setTeams);
    load();
    return onTerminalTabVisible(load);
  }, []);

  return (
    <div className="terminal-navbar" ref={ref}>
      <button type="button" className="icon-btn" title="New terminal" onClick={() => requestNewTerminal()}>
        <PlusIcon className="hero-icon" /> New
      </button>
      <TeamsMenu teams={teams} label="Teams" title="Load a saved team" onLoad={requestLoadTeam} onDeleted={setTeams} />
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
    </div>
  );
}
