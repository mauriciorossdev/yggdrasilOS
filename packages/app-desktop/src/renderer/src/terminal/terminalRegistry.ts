import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

/**
 * Holds the actual live xterm.js Terminal + pty state per leaf id, owned by
 * TerminalContainer (a `useRef`, so it survives that component's own
 * re-renders) — deliberately NOT stored in any React component's state.
 * TerminalPane instances come and go (React remounts whatever renders at a
 * tree position whose element type changes, e.g. a leaf gaining a sibling
 * via split — no key can prevent that), but the entries here don't; a
 * remounted TerminalPane just re-parents the existing entry's DOM into its
 * new container instead of recreating the terminal/pty from scratch.
 */
export type TerminalEntry = {
  term: Terminal;
  fitAddon: FitAddon;
  opened: boolean;
  exited: boolean;
  exitCode: number | null;
  unsubData?: () => void;
  unsubExit?: () => void;
  unsubTheme?: () => void;
  /** Set by whichever TerminalPane instance currently owns this leaf's DOM, so a later spontaneous exit can update its `exited` UI state. */
  onExitedChange?: () => void;
  /** Whether this leaf's stored `initialPrompt` has already been sent via the "Send task" button — lives here (not component state) for the same reason `exited` does: a remount must not forget it and re-offer to send a task twice. */
  taskSent: boolean;
};

export type TerminalRegistry = Map<string, TerminalEntry>;
