/** Keep in sync with the side-panel-in/out animations in styles.css. */
export const SIDE_PANEL_MOTION_MS = 240;

/** Opening width: roughly a half, never so wide it squeezes the chat or so narrow it is cramped. */
export function defaultPanelWidth(viewportWidth: number): number {
  return Math.round(Math.min(760, Math.max(420, viewportWidth * 0.45)));
}

/** Drag bounds: at least a usable column, and the chat keeps a quarter of the window. */
export function clampPanelWidth(width: number, viewportWidth: number): number {
  const max = Math.max(280, viewportWidth * 0.75);
  return Math.round(Math.min(max, Math.max(280, width)));
}

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

/** The aside's tabs: every open panel, which one shows, and the slide animation phase. */
export type SidePanelState<P> = { tabs: P[]; activeKey: string | null; phase: SidePanelPhase };

export type SidePanelAction<P> =
  | { type: "open"; panel: P }
  | { type: "activate"; key: string }
  | { type: "closeTab"; key: string }
  | { type: "close" }
  | { type: "settled" };

export function initialSidePanelState<P>(): SidePanelState<P> {
  return { tabs: [], activeKey: null, phase: "open" };
}

/**
 * Opening something already open just activates it (replacing its content, e.g. a
 * diff that now has a filePath); anything new gets its own tab. The panel has to stay
 * mounted while it slides out, so closing the last tab (or all of it) is two steps:
 * "exit" starts the animation and "settled" drops the tabs. Showing another tab in a
 * panel that is already open must not replay the entrance.
 */
export function createSidePanelReducer<P>(keyOf: (panel: P) => string) {
  return function sidePanelReducer(state: SidePanelState<P>, action: SidePanelAction<P>): SidePanelState<P> {
    switch (action.type) {
      case "open": {
        const key = keyOf(action.panel);
        const exists = state.tabs.some((p) => keyOf(p) === key);
        const tabs = exists ? state.tabs.map((p) => (keyOf(p) === key ? action.panel : p)) : [...state.tabs, action.panel];
        const visible = state.tabs.length > 0 && state.phase !== "exit";
        // Reopening during the exit starts from the new tab only; the old ones are gone.
        return {
          tabs: visible ? tabs : [action.panel],
          activeKey: key,
          phase: visible ? state.phase : "enter",
        };
      }
      case "activate":
        return state.tabs.some((p) => keyOf(p) === action.key) ? { ...state, activeKey: action.key } : state;
      case "closeTab": {
        const index = state.tabs.findIndex((p) => keyOf(p) === action.key);
        if (index === -1) return state;
        if (state.tabs.length === 1) return { ...state, phase: "exit" };
        const tabs = state.tabs.filter((_, i) => i !== index);
        const activeKey =
          state.activeKey === action.key ? keyOf(tabs[Math.min(index, tabs.length - 1)]!) : state.activeKey;
        return { ...state, tabs, activeKey };
      }
      case "close":
        return state.tabs.length > 0 ? { ...state, phase: "exit" } : state;
      case "settled":
        if (state.phase === "exit") return initialSidePanelState();
        return state.phase === "enter" ? { ...state, phase: "open" } : state;
    }
  };
}
