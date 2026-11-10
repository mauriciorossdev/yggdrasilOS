import { useSyncExternalStore } from "react";
import type { ChangeViewMode } from "./changeTree.js";

const KEY = "ygg.changes.viewMode";
const listeners = new Set<() => void>();

function read(): ChangeViewMode {
  try {
    return localStorage.getItem(KEY) === "tree" ? "tree" : "list";
  } catch {
    return "list";
  }
}

let current: ChangeViewMode = read();

function setMode(next: ChangeViewMode): void {
  current = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // storage unavailable — the choice just won't persist
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** List or tree, shared by every change list in the window (sidebar and Repositorio) and remembered across reloads. */
export function useChangeViewMode(): [ChangeViewMode, (mode: ChangeViewMode) => void] {
  return [useSyncExternalStore(subscribe, () => current), setMode];
}
