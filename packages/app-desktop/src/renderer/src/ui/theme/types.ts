/** The four colors a user can change; every other color token is derived from these in tokens.css. */
export const CORE_KEYS = ["bg", "surface", "text", "accent"] as const;
export type CoreKey = (typeof CORE_KEYS)[number];
export type ThemeCore = Record<CoreKey, string>;

/** What is persisted (main/themeSettings.ts mirrors this shape): a preset plus per-color overrides on top of it. */
export type ThemeSettings = { presetId: string; overrides: Partial<ThemeCore> };

export const DEFAULT_PRESET_ID = "warm-dark";
export const DEFAULT_THEME: ThemeSettings = { presetId: DEFAULT_PRESET_ID, overrides: {} };

export const CORE_LABELS: Record<CoreKey, string> = {
  bg: "Fondo",
  surface: "Superficie",
  text: "Texto",
  accent: "Acento",
};
