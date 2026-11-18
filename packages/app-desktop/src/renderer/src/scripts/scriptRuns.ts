import { useSyncExternalStore } from "react";
import { SCRIPT_PANE_PREFIX } from "../terminal/paneTree.js";

export { SCRIPT_PANE_PREFIX };

/**
 * package.json scripts started from the sidebar as panes of the app's own
 * Terminal tab. One run per script name per window (a window is one
 * project). Module-level store, same shape as ui/mainTabsStore.ts: the
 * sidebar (ScriptsSection) and the pane tree (TerminalContainer) have no
 * shared ancestor state.
 */

export type ScriptStatus = "running" | "done" | "failed" | "stopped";

export type ScriptRun = {
  paneId: string;
  status: ScriptStatus;
  exitCode: number | null;
  /** Ctrl+C was sent from the sidebar, so however it exits it is "stopped". */
  stopRequested: boolean;
};

export type ScriptRuns = ReadonlyMap<string, ScriptRun>;

let runs: ScriptRuns = new Map();
const listeners = new Set<() => void>();

function publish(next: Map<string, ScriptRun>): void {
  runs = next;
  for (const fn of [...listeners]) fn();
}

export function getScriptRuns(): ScriptRuns {
  return runs;
}

export function useScriptRuns(): ScriptRuns {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => runs,
  );
}

/** A script's pane was just created (replaces any previous run of the same script). */
export function markStarted(name: string, paneId: string): void {
  const next = new Map(runs);
  next.set(name, { paneId, status: "running", exitCode: null, stopRequested: false });
  publish(next);
}

export function markStopRequested(name: string): void {
  const run = runs.get(name);
  if (!run || run.status !== "running") return;
  const next = new Map(runs);
  next.set(name, { ...run, stopRequested: true });
  publish(next);
}

/** The pane's own "Restart" button respawned its pty: the script is running again. */
export function markRestarted(paneId: string): void {
  for (const [name, run] of runs) {
    if (run.paneId !== paneId || run.status === "running") continue;
    const next = new Map(runs);
    next.set(name, { ...run, status: "running", exitCode: null, stopRequested: false });
    publish(next);
    return;
  }
}

/** A pty exited; ignored unless it belongs to a tracked script. */
export function markExit(paneId: string, exitCode: number | null): void {
  for (const [name, run] of runs) {
    if (run.paneId !== paneId || run.status !== "running") continue;
    // npm exits 0 on Ctrl+C, so a requested stop wins over the code.
    const status: ScriptStatus = run.stopRequested ? "stopped" : exitCode === 0 ? "done" : "failed";
    const next = new Map(runs);
    next.set(name, { ...run, status, exitCode });
    publish(next);
    return;
  }
}

/** Forgets runs whose pane was closed. */
export function syncOpenPanes(openPaneIds: ReadonlySet<string>): void {
  let next: Map<string, ScriptRun> | null = null;
  for (const [name, run] of runs) {
    if (openPaneIds.has(run.paneId)) continue;
    next ??= new Map(runs);
    next.delete(name);
  }
  if (next) publish(next);
}

/** Tests only. */
export function resetScriptRuns(): void {
  runs = new Map();
  listeners.clear();
}

// Sidebar -> TerminalContainer commands (a pane tree reducer lives there).
export type ScriptCommand =
  | { type: "run"; name: string; packageManager: string; cwd: string }
  /** Closes the previous pane of this script and starts it again. */
  | { type: "restart"; name: string; packageManager: string; cwd: string }
  /** Brings the script's pane into view (switches to the Terminal tab). */
  | { type: "focus"; name: string };

let commandListener: ((command: ScriptCommand) => void) | null = null;

export function onScriptCommand(fn: (command: ScriptCommand) => void): () => void {
  commandListener = fn;
  return () => {
    if (commandListener === fn) commandListener = null;
  };
}

export function requestScriptCommand(command: ScriptCommand): void {
  commandListener?.(command);
}
