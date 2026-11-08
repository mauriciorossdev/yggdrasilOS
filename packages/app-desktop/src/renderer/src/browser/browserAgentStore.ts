import { useSyncExternalStore } from "react";
import { DEFAULT_PREFS, parsePrefs, type BrowserAgentPrefs } from "./browserAgentState.js";

// The Browser tab's docked agent. The pane itself (xterm + pty) is owned by
// TerminalContainer like any other pane — it is rendered into the dock through
// a React portal targeting `slot` — so BrowserTabView (which provides the slot
// and the dock chrome) and TerminalContainer (which owns the pane tree) only
// meet through this module-level store, the same shape as terminalBridge.ts.
// Preferences persist per project in localStorage.

const KEY = `ygg.browser.agent.${typeof window !== "undefined" ? window.yggdrasil?.projectId : ""}`;

function load(): BrowserAgentPrefs {
  try {
    return parsePrefs(localStorage.getItem(KEY));
  } catch {
    return DEFAULT_PREFS;
  }
}

export type BrowserAgentState = BrowserAgentPrefs & { slot: HTMLElement | null };

let state: BrowserAgentState = { ...(typeof window !== "undefined" ? load() : DEFAULT_PREFS), slot: null };
const listeners = new Set<() => void>();

function set(patch: Partial<BrowserAgentState>): void {
  const next = { ...state, ...patch };
  if (next.dockedId === state.dockedId && next.open === state.open && next.width === state.width && next.slot === state.slot) return;
  const persistedChanged = next.dockedId !== state.dockedId || next.open !== state.open || next.width !== state.width;
  state = next;
  if (persistedChanged) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ dockedId: next.dockedId, open: next.open, width: next.width }));
    } catch {
      // storage unavailable: preferences just won't survive a restart
    }
  }
  listeners.forEach((fn) => fn());
}

/** Current state outside React (event handlers that run right after a store change, before any re-render). */
export const getBrowserAgent = (): BrowserAgentState => state;

export function useBrowserAgent(): BrowserAgentState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
  );
}

/** Which pane lives in the dock (null: none — it is back in the Terminal tab's grid). */
export const dockPane = (id: string | null): void => set({ dockedId: id });
export const setDockOpen = (open: boolean): void => set({ open });
export const toggleDockOpen = (): void => set({ open: !state.open });
export const setDockWidth = (width: number): void => set({ width });
/** Ref callback for the element the dock renders the pane into. */
export const setBrowserAgentSlot = (el: HTMLElement | null): void => set({ slot: el });

export type CreateAgentRequest = { command: string; label: string };
let createListener: ((req: CreateAgentRequest) => void) | null = null;

/** TerminalContainer registers how to spawn a new pane and dock it. */
export function onCreateBrowserAgent(fn: (req: CreateAgentRequest) => void): () => void {
  createListener = fn;
  return () => {
    if (createListener === fn) createListener = null;
  };
}

export function requestCreateBrowserAgent(req: CreateAgentRequest): void {
  createListener?.(req);
}
