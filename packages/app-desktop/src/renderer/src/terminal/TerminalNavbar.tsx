import { useEffect, useRef, useState } from "react";
import { ArrowsPointingInIcon, PlusIcon, RectangleGroupIcon, Squares2X2Icon } from "@heroicons/react/20/solid";
import { useI18n, type MessageKey } from "../i18n/index.js";
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

const OPTIONS: Array<{ layout: ArrangeLayout; labelKey: MessageKey }> = [
  { layout: "row", labelKey: "term.navbar.row" },
  { layout: "2row", labelKey: "term.navbar.twoRows" },
  { layout: "2x2", labelKey: "term.navbar.grid2x2" },
  { layout: "3x3", labelKey: "term.navbar.grid3x3" },
  { layout: "auto", labelKey: "term.navbar.auto" },
];

/** Same click-outside/Escape-to-close pattern as ProjectContextMenu.tsx/FileTreeContextMenu.tsx, reusing the same .context-menu styling — a clickable dropdown, not a hover tooltip. */
export function TerminalNavbar({ disabled, onArrange, viewMode, onToggleViewMode, onCompactAll, onSendCommand }: Props) {
  const { t } = useI18n();
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
      <button type="button" className="icon-btn" title={t("term.navbar.newTitle")} onClick={() => requestNewTerminal()}>
        <PlusIcon className="hero-icon" /> {t("term.navbar.new")}
      </button>
      <TeamsMenu teams={teams} label={t("term.navbar.teams")} title={t("term.navbar.teamsTitle")} onLoad={requestLoadTeam} onDeleted={setTeams} />
      {viewMode === "grid" && (
        <>
          <button
            type="button"
            className="icon-btn"
            title={t("term.navbar.arrangeTitle")}
            disabled={disabled}
            onClick={() => setOpen((o) => !o)}
          >
            <Squares2X2Icon className="hero-icon" /> {t("term.navbar.arrange")}
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
                  {t(opt.labelKey)}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      <button
        type="button"
        className={`icon-btn${viewMode === "canvas" ? " active" : ""}`}
        title={t(viewMode === "canvas" ? "term.navbar.toGrid" : "term.navbar.toCanvas")}
        disabled={disabled}
        onClick={onToggleViewMode}
      >
        <RectangleGroupIcon className="hero-icon" /> {t("term.navbar.canvas")}
      </button>
      <button
        type="button"
        className="icon-btn"
        title={t("term.navbar.compactTitle")}
        disabled={disabled}
        onClick={onCompactAll}
      >
        <ArrowsPointingInIcon className="hero-icon" /> {t("term.navbar.compact")}
      </button>
      <CommandsMenu disabled={disabled} onSelect={onSendCommand} />
    </div>
  );
}
