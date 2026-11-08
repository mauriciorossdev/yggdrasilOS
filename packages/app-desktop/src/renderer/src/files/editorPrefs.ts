import { useSyncExternalStore } from "react";

// Mirrors main/editorSettings.ts (main and renderer have separate tsconfigs).
export type EditorPrefs = {
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  minimap: boolean;
  formatOnSave: boolean;
  fixOnSave: boolean;
};

let prefs: EditorPrefs = { fontSize: 13, tabSize: 2, wordWrap: true, minimap: false, formatOnSave: false, fixOnSave: false };
let started = false;
const listeners = new Set<() => void>();

function publish(next: EditorPrefs): void {
  prefs = next;
  for (const listener of listeners) listener();
}

/** Loads the saved prefs once and follows changes made in any window. */
function start(): void {
  if (started) return;
  started = true;
  window.yggdrasil.editorSettings.onChange(publish);
  void window.yggdrasil.editorSettings.get().then(publish);
}

function subscribe(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useEditorPrefs(): EditorPrefs {
  return useSyncExternalStore(subscribe, () => prefs);
}

/** For code outside React (saving a file). */
export function getEditorPrefs(): EditorPrefs {
  return prefs;
}

export function updateEditorPrefs(patch: Partial<EditorPrefs>): void {
  const next = { ...prefs, ...patch };
  publish(next);
  void window.yggdrasil.editorSettings.set(next);
}
