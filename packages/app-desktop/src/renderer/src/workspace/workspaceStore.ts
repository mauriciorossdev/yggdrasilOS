import { useSyncExternalStore } from "react";

/**
 * The container beside the chat: tabs for whatever gets opened from the chat (today a spreadsheet; later
 * documents and slides). Module-level store with the same shape as ui/mainTabsStore.ts, because what opens
 * a tab (a click in the chat, an agent's tool call, the file tree) lives far from what draws it.
 */

export type WorkspaceKind = "sheet" | "doc" | "deck";

export type WorkspaceTab = {
  id: string;
  kind: WorkspaceKind;
  /** Project-relative path of the file. */
  path: string;
};

export type WorkspaceState = { tabs: WorkspaceTab[]; activeId: string | null };

const EMPTY: WorkspaceState = { tabs: [], activeId: null };

let state: WorkspaceState = EMPTY;
const listeners = new Set<() => void>();

export function tabIdFor(kind: WorkspaceKind, path: string): string {
  return `${kind}:${path}`;
}

/** The kind of workspace editor that handles a file, or null when it has none (it then opens the usual way). */
export function workspaceKindFor(path: string): WorkspaceKind | null {
  if (/\.xlsx$/i.test(path)) return "sheet";
  if (/\.docx$/i.test(path)) return "doc";
  if (/\.pptx$/i.test(path)) return "deck";
  return null;
}

/** Pure transitions, exported for tests. */
export function openTab(s: WorkspaceState, kind: WorkspaceKind, path: string): WorkspaceState {
  const id = tabIdFor(kind, path);
  if (s.tabs.some((t) => t.id === id)) return { ...s, activeId: id };
  return { tabs: [...s.tabs, { id, kind, path }], activeId: id };
}

export function closeTab(s: WorkspaceState, id: string): WorkspaceState {
  const index = s.tabs.findIndex((t) => t.id === id);
  if (index === -1) return s;
  const tabs = s.tabs.filter((t) => t.id !== id);
  const activeId = s.activeId === id ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? null) : s.activeId;
  return { tabs, activeId };
}

function set(next: WorkspaceState): void {
  if (next === state) return;
  state = next;
  listeners.forEach((fn) => fn());
}

export function openWorkspaceTab(kind: WorkspaceKind, path: string): void {
  set(openTab(state, kind, path));
}

export function closeWorkspaceTab(id: string): void {
  set(closeTab(state, id));
}

export function activateWorkspaceTab(id: string): void {
  if (state.tabs.some((t) => t.id === id)) set({ ...state, activeId: id });
}

export function getWorkspaceState(): WorkspaceState {
  return state;
}

export function resetWorkspaceForTest(): void {
  state = EMPTY;
}

export function useWorkspace(): WorkspaceState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
    () => EMPTY,
  );
}
