import { useRef, useState } from "react";
import { CommandLineIcon } from "@heroicons/react/20/solid";
import { useDismiss } from "../ui/useDismiss.js";

type Props = {
  disabled: boolean;
  onSelect: (command: string) => void;
};

/**
 * Claude Code's built-in slash commands — there's no runtime API to list
 * these (no command-palette/registry anywhere in the codebase, confirmed by
 * search), so this is a static list of the documented ones. Sent as plain
 * text to a pane, same as anything else typed there.
 */
const COMMANDS = [
  "/add-dir",
  "/agents",
  "/bug",
  "/clear",
  "/compact",
  "/config",
  "/cost",
  "/doctor",
  "/export",
  "/help",
  "/hooks",
  "/ide",
  "/init",
  "/login",
  "/logout",
  "/migrate-installer",
  "/mcp",
  "/memory",
  "/model",
  "/output-style",
  "/permissions",
  "/pr-comments",
  "/resume",
  "/review",
  "/rewind",
  "/sandbox",
  "/status",
  "/terminal-setup",
  "/todos",
  "/usage",
  "/vim",
];

/** Same click-outside/Escape-to-close dropdown as TerminalNavbar's "Arrange" menu, reusing `.context-menu` styling plus a scroll cap (`.terminal-commands-menu`) since this list runs longer than a typical context menu. */
export function CommandsMenu({ disabled, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useDismiss(ref, () => setOpen(false), open);

  return (
    <div className="commands-menu" ref={ref}>
      <button
        type="button"
        className="icon-btn"
        title="Send a Claude Code command to the team's orchestrator pane"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <CommandLineIcon className="hero-icon" /> Commands
      </button>
      {open && (
        <div className="context-menu terminal-commands-menu">
          {COMMANDS.map((cmd) => (
            <button
              key={cmd}
              type="button"
              className="context-menu-item"
              onClick={() => {
                onSelect(cmd);
                setOpen(false);
              }}
            >
              {cmd}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
