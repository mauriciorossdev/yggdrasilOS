import { useSyncExternalStore, type ReactNode } from "react";

// Which main section (Chat, Terminal, ...) this window is showing, plus the
// complemento tabs opened next to them. The sidebar's navigation (chat/MainNav)
// and the panel host (chat/MainTabs) live in different parts of the tree, so
// both read this module-level store, the same shape as terminal/usePaneSpec.ts.

export type BuiltinMainTab =
  | "home"
  | "chat"
  | "terminal"
  | "agentFlow"
  | "workflows"
  | "documents"
  | "browser"
  | "studio"
  | "repository";
/** `plugin:<scope>:<id>` (PluginRecord.key) for a complemento opened as a tab, see ChatView.tsx's openPluginTabs. */
export type MainTab = BuiltinMainTab | `plugin:${string}`;

/** The navigation-facing part of an open complemento tab (its content stays with MainTabs). */
export type ExtraTabMeta = { id: MainTab; label: string; icon?: ReactNode; onClose: () => void };

export const MAIN_TAB_LABELS: Record<BuiltinMainTab, string> = {
  home: "Home",
  chat: "Chat",
  terminal: "Terminal",
  agentFlow: "Agent Flow",
  workflows: "Workflows",
  documents: "Documents",
  browser: "Browser",
  studio: "Estudio",
  repository: "Repositorio",
};

/**
 * The tab that should really be showing: a closed complemento tab or Home in a
 * window that has no Home (only the main window does) fall back to Chat rather
 * than leaving a blank panel with nothing highlighted in the navigation.
 */
export function resolveActiveTab(active: MainTab, extraTabIds: string[], isMainWindow: boolean): MainTab {
  if (active.startsWith("plugin:") && !extraTabIds.includes(active)) return "chat";
  if (active === "home" && !isMainWindow) return "chat";
  return active;
}

const isMainWindow = typeof window !== "undefined" && window.yggdrasil?.isDefaultProject === true;

let active: MainTab = isMainWindow ? "home" : "chat";
let extraTabs: ExtraTabMeta[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getActiveTab(): MainTab {
  return active;
}

export function setActiveTab(tab: MainTab): void {
  if (tab === active) return;
  active = tab;
  emit();
}

export function setExtraTabs(tabs: ExtraTabMeta[]): void {
  extraTabs = tabs;
  emit();
}

export function useActiveTab(): MainTab {
  return useSyncExternalStore(subscribe, getActiveTab);
}

export function useExtraTabs(): ExtraTabMeta[] {
  return useSyncExternalStore(subscribe, () => extraTabs);
}

export function viewLabel(tab: MainTab, tabs: ExtraTabMeta[]): string {
  if (tab.startsWith("plugin:")) return tabs.find((t) => t.id === tab)?.label ?? "Complemento";
  return MAIN_TAB_LABELS[tab as BuiltinMainTab] ?? "";
}
