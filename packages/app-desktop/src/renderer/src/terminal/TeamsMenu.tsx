import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon, TrashIcon } from "@heroicons/react/20/solid";
import type { AgentTeam } from "../types.js";

type Props = {
  teams: AgentTeam[];
  label: string;
  title?: string;
  onLoad: (team: AgentTeam) => void;
  onDeleted: (teams: AgentTeam[]) => void;
};

/**
 * Same click-outside/Escape-to-close dropdown as TerminalNavbar's "Arrange"
 * menu, reusing the same .context-menu styling — replaces what used to be a
 * plain `<select>` ("Teams ▾" in MainTabs.tsx, "Open Team ▾" in
 * AgentFlowView.tsx), which could only load a saved team, never delete one.
 * A native `<select>` has no room for a per-option action, hence the switch
 * to this row-based menu (same load+delete shape TerminalContainer.tsx's
 * empty-state team list already used, just not reachable once a canvas/
 * layout already has content).
 */
export function TeamsMenu({ teams, label, title, onLoad, onDeleted }: Props) {
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

  if (teams.length === 0) return null;

  const deleteTeam = (team: AgentTeam) => {
    if (!window.confirm(`Delete team "${team.name}"? This can't be undone.`)) return;
    void window.yggdrasil.agentTeams.delete(team.id).then(onDeleted);
  };

  return (
    <div className="teams-menu" ref={ref}>
      <button type="button" className="main-tab-teams-select" title={title} onClick={() => setOpen((o) => !o)}>
        {label}
        <ChevronDownIcon className="hero-icon" />
      </button>
      {open && (
        <div className="context-menu teams-menu-list">
          {teams.map((team) => (
            <div key={team.id} className="terminal-team-row">
              <button
                type="button"
                className="context-menu-item"
                onClick={() => {
                  onLoad(team);
                  setOpen(false);
                }}
              >
                {team.name}
              </button>
              <button type="button" className="icon-btn" title="Delete team" onClick={() => deleteTeam(team)}>
                <TrashIcon className="hero-icon" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
