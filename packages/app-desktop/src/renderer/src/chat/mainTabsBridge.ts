/** Same pub-sub shape as terminal/terminalBridge.ts — lets a component outside MainTabs (AgentFlowView's "Load into Terminal", a plugin's own ygg.app.openTab call) switch the active tab without lifting MainTabs's local tab state. */
import type { MainTab } from "./MainTabs.js";

type Listener = (tab: MainTab) => void;

let listener: Listener | null = null;

export function onRequestTab(fn: Listener): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

export function requestTab(tab: MainTab): void {
  listener?.(tab);
}

/** Kept for AgentFlowView's existing call sites — equivalent to requestTab("terminal"). */
export function requestTerminalTab(): void {
  requestTab("terminal");
}
