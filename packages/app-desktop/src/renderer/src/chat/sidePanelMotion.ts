/** Keep in sync with the side-panel-in/out animations in styles.css. */
export const SIDE_PANEL_MOTION_MS = 240;

const PINNED_KEY = "yggdrasil.sidePanel.pinned";

export function readPanelPinned(): boolean {
  try {
    return localStorage.getItem(PINNED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writePanelPinned(pinned: boolean): void {
  try {
    if (pinned) localStorage.setItem(PINNED_KEY, "1");
    else localStorage.removeItem(PINNED_KEY);
  } catch {
    // storage unavailable: the choice just won't persist
  }
}

export type SidePanelPhase = "enter" | "open" | "exit";

export type SidePanelState<P> = { panel: P | null; phase: SidePanelPhase };

export type SidePanelAction<P> = { type: "open"; panel: P } | { type: "close" } | { type: "settled" };

/**
 * The panel has to stay mounted while it slides out, so closing is two steps:
 * "close" starts the animation and "settled" drops the panel. Showing another
 * file in a panel that is already open must not replay the entrance.
 */
export function sidePanelReducer<P>(state: SidePanelState<P>, action: SidePanelAction<P>): SidePanelState<P> {
  switch (action.type) {
    case "open":
      return { panel: action.panel, phase: state.panel && state.phase !== "exit" ? state.phase : "enter" };
    case "close":
      return state.panel ? { ...state, phase: "exit" } : state;
    case "settled":
      if (state.phase === "exit") return { panel: null, phase: "open" };
      return state.phase === "enter" ? { ...state, phase: "open" } : state;
  }
}
