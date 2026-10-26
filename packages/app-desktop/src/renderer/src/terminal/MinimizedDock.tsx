import { useEffect, useRef, useState } from "react";
import type { LeafPane } from "./paneTree.js";

type Props = {
  panes: LeafPane[];
  onRestore: (id: string) => void;
};

/** A pane counts as "working" while it printed something within this window. */
const WORKING_WINDOW_MS = 2000;
const CHECK_INTERVAL_MS = 500;

/**
 * Ids of panes that produced output recently. Fed by the pty data stream
 * (the panes keep running while minimized), so it works without the pane being
 * mounted visibly. State only changes when a pane flips between working and
 * quiet — not on every chunk — so a busy pane doesn't re-render the dock.
 */
function useWorkingPanes(): Set<string> {
  const lastOutput = useRef<Map<string, number>>(new Map());
  const [working, setWorking] = useState<Set<string>>(new Set());

  useEffect(() => {
    const unsubscribe = window.yggdrasil.terminals.onData((id) => {
      lastOutput.current.set(id, Date.now());
    });
    const timer = setInterval(() => {
      const now = Date.now();
      const next = new Set<string>();
      for (const [id, at] of lastOutput.current) {
        if (now - at < WORKING_WINDOW_MS) next.add(id);
        else lastOutput.current.delete(id);
      }
      setWorking((prev) => (prev.size === next.size && [...next].every((id) => prev.has(id)) ? prev : next));
    }, CHECK_INTERVAL_MS);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, []);

  return working;
}

/**
 * Fixed strip along the bottom of the Terminal tab listing minimized panes
 * as chips — click to restore. Purely a display of TerminalContainer's own
 * `minimizedIds` state; the panes themselves (and their ptys) keep running
 * untouched while minimized, see projectVisibleTree in paneTree.ts. A chip
 * pulses while its pane is producing output.
 */
export function MinimizedDock({ panes, onRestore }: Props) {
  const working = useWorkingPanes();

  return (
    <div className="minimized-dock">
      {panes.map((pane) => (
        <button
          key={pane.id}
          type="button"
          className={`minimized-chip${working.has(pane.id) ? " working" : ""}`}
          title={`Restore "${pane.title}"${working.has(pane.id) ? " — working" : ""}`}
          onClick={() => onRestore(pane.id)}
        >
          {pane.title}
        </button>
      ))}
    </div>
  );
}
