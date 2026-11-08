import { readSettingsFile, updateSettingsFile } from "./settingsFile.js";

// Mirrors renderer/src/files/editorPrefs.ts (main and renderer have separate tsconfigs).
export type EditorSettings = {
  fontSize: number;
  /** Indent width for files whose own indentation can't be detected. */
  tabSize: number;
  wordWrap: boolean;
  minimap: boolean;
  formatOnSave: boolean;
  /** Applies a linter's safe fixes on save (ESLint). */
  fixOnSave: boolean;
};

export function defaultEditorSettings(): EditorSettings {
  return { fontSize: 13, tabSize: 2, wordWrap: true, minimap: false, formatOnSave: false, fixOnSave: false };
}

function clampedInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Whatever the renderer or an old settings file hands us, reduced to safe settings. */
export function sanitizeEditorSettings(raw: unknown): EditorSettings {
  const input = (raw ?? {}) as Partial<Record<keyof EditorSettings, unknown>>;
  const d = defaultEditorSettings();
  return {
    fontSize: clampedInt(input.fontSize, 8, 32, d.fontSize),
    tabSize: clampedInt(input.tabSize, 1, 8, d.tabSize),
    wordWrap: typeof input.wordWrap === "boolean" ? input.wordWrap : d.wordWrap,
    minimap: typeof input.minimap === "boolean" ? input.minimap : d.minimap,
    formatOnSave: typeof input.formatOnSave === "boolean" ? input.formatOnSave : d.formatOnSave,
    fixOnSave: typeof input.fixOnSave === "boolean" ? input.fixOnSave : d.fixOnSave,
  };
}

/** Stored in desktop-settings.json under "editor", next to the theme. */
export async function loadEditorSettings(userDataDir: string): Promise<EditorSettings> {
  const raw = await readSettingsFile(userDataDir);
  return sanitizeEditorSettings((raw as { editor?: unknown }).editor);
}

export async function saveEditorSettings(userDataDir: string, settings: EditorSettings): Promise<EditorSettings> {
  const clean = sanitizeEditorSettings(settings);
  await updateSettingsFile(userDataDir, (existing) => ({ ...existing, editor: clean }));
  return clean;
}
