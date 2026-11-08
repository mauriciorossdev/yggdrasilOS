import { useSyncExternalStore } from "react";

// Sidebar layout preferences (minimized to the icon rail; Terminal entry
// expanded to list its panes). Same module-level-store shape as
// mainTabsStore.ts; remembered across restarts in localStorage (per-user
// layout preference, not per project).

function persistedFlag(key: string, initial: boolean) {
  const read = (): boolean => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : raw === "1";
    } catch {
      return initial;
    }
  };
  let value = typeof window !== "undefined" ? read() : initial;
  const listeners = new Set<() => void>();
  const subscribe = (fn: () => void): (() => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };
  const set = (next: boolean): void => {
    if (next === value) return;
    value = next;
    try {
      localStorage.setItem(key, next ? "1" : "0");
    } catch {
      // storage unavailable: the preference just won't survive a restart
    }
    listeners.forEach((fn) => fn());
  };
  return {
    set,
    toggle: () => set(!value),
    use: () => useSyncExternalStore(subscribe, () => value),
  };
}

const collapsed = persistedFlag("ygg.sidebar.collapsed", false);
export const setSidebarCollapsed = collapsed.set;
export const toggleSidebarCollapsed = collapsed.toggle;
export const useSidebarCollapsed = collapsed.use;

// Workflows is a niche feature: hidden from the sidebar unless the user turns
// it on in Settings → General. Hiding only removes the entry — workflows and
// their triggers keep running in the gateway.
const workflowsShown = persistedFlag("ygg.sidebar.showWorkflows", false);
export const setShowWorkflows = workflowsShown.set;
export const useShowWorkflows = workflowsShown.use;

const terminalsOpen = persistedFlag("ygg.sidebar.terminalsOpen", true);
export const toggleTerminalsList = terminalsOpen.toggle;
export const useTerminalsListOpen = terminalsOpen.use;
