import type { LeafPane } from "./paneTree.js";

type Props = {
  panes: LeafPane[];
  onRestore: (id: string) => void;
};

/**
 * Fixed strip along the bottom of the Terminal tab listing minimized panes
 * as chips — click to restore. Purely a display of TerminalContainer's own
 * `minimizedIds` state; the panes themselves (and their ptys) keep running
 * untouched while minimized, see projectVisibleTree in paneTree.ts.
 */
export function MinimizedDock({ panes, onRestore }: Props) {
  return (
    <div className="minimized-dock">
      {panes.map((pane) => (
        <button
          key={pane.id}
          type="button"
          className="minimized-chip"
          title={`Restore "${pane.title}"`}
          onClick={() => onRestore(pane.id)}
        >
          {pane.title}
        </button>
      ))}
    </div>
  );
}
