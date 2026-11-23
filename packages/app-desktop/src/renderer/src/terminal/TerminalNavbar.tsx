import { useEffect, useRef, useState } from "react";
import { ArrowsPointingInIcon, PlusIcon, RectangleGroupIcon, Squares2X2Icon } from "@heroicons/react/20/solid";
import { useI18n, type MessageKey } from "../i18n/index.js";
import type { ArrangeLayout } from "./arrangeLayouts.js";
import type { AgentTeam } from "../types.js";
import { onTerminalTabVisible, requestLoadTeam, requestNewTerminal } from "./terminalBridge.js";
import { TeamsMenu } from "./TeamsMenu.js";
import { CommandsMenu } from "./CommandsMenu.js";
import { useDismiss } from "@yggdrasil/ui-kit";
import { useShowRamBar } from "../ui/sidebarStore.js";

const SEGMENT_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ec4899", "#06b6d4", "#ef4444", "#a855f7", "#84cc16"];

function fmtBytes(n: number): string {
  return n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : `${Math.round(n / 1024 ** 2)} MB`;
}

/** Stacked bar: RAM used by all panes over the machine's total, one colored segment per pane (hover → pane + usage). */
function RamBar({ panes }: { panes: Array<{ id: string; title: string }> }) {
  const { t } = useI18n();
  const [data, setData] = useState<{ totalBytes: number; usedBytes: number; appBytes: number; panes: Array<{ id: string; rssBytes: number }> } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void window.yggdrasil.terminals.memoryAll().then((d) => alive && setData(d)).catch(() => {});
    load();
    const timer = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  if (!data || data.panes.length === 0) return null;
  const titles = new Map(panes.map((p) => [p.id, p.title]));
  const segs = data.panes.map((p, i) => ({ ...p, title: titles.get(p.id) ?? p.id, color: SEGMENT_COLORS[i % SEGMENT_COLORS.length] }));
  const panesUsed = segs.reduce((n, s) => n + s.rssBytes, 0);
  const other = Math.max(0, data.usedBytes - panesUsed - data.appBytes);
  return (
    <div className="terminal-ram" aria-label={t("term.navbar.ramTitle")}>
      <div className="terminal-ram-bar">
        {segs.map((s) => (
          <div
            key={s.id}
            className="terminal-ram-seg"
            style={{ width: `${(s.rssBytes / data.totalBytes) * 100}%`, background: s.color }}
            title={`${s.title}: ${fmtBytes(s.rssBytes)}`}
          />
        ))}
        <div
          className="terminal-ram-seg"
          style={{ width: `${(data.appBytes / data.totalBytes) * 100}%`, background: "#64748b" }}
          title={`${t("term.navbar.ramApp")}: ${fmtBytes(data.appBytes)}`}
        />
        <div
          className="terminal-ram-seg"
          style={{ width: `${(other / data.totalBytes) * 100}%`, background: "#9ca3af" }}
          title={`${t("term.navbar.ramOther")}: ${fmtBytes(other)}`}
        />
      </div>
      <span className="terminal-ram-label">
        {fmtBytes(data.usedBytes)} {t("term.navbar.ramOf")} {fmtBytes(data.totalBytes)}
      </span>
    </div>
  );
}

type Props = {
  disabled: boolean;
  onArrange: (layout: ArrangeLayout) => void;
  viewMode: "grid" | "canvas";
  onToggleViewMode: () => void;
  onCompactAll: () => void;
  onSendCommand: (command: string) => void;
  panes: Array<{ id: string; title: string }>;
};

const OPTIONS: Array<{ layout: ArrangeLayout; labelKey: MessageKey }> = [
  { layout: "row", labelKey: "term.navbar.row" },
  { layout: "2row", labelKey: "term.navbar.twoRows" },
  { layout: "2x2", labelKey: "term.navbar.grid2x2" },
  { layout: "3x3", labelKey: "term.navbar.grid3x3" },
  { layout: "auto", labelKey: "term.navbar.auto" },
];

/** Same click-outside/Escape-to-close pattern as ProjectContextMenu.tsx/FileTreeContextMenu.tsx, reusing the same .context-menu styling — a clickable dropdown, not a hover tooltip. */
export function TerminalNavbar({ disabled, onArrange, viewMode, onToggleViewMode, onCompactAll, onSendCommand, panes }: Props) {
  const { t } = useI18n();
  const showRamBar = useShowRamBar();
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
      {showRamBar && <RamBar panes={panes} />}
    </div>
  );
}
