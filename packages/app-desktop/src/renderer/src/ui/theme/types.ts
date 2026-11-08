import type { MessageKey } from "../../i18n/index.js";

/** The four colors a user can change; every other color token is derived from these in tokens.css. */
export const CORE_KEYS = ["bg", "surface", "text", "accent"] as const;
export type CoreKey = (typeof CORE_KEYS)[number];
export type ThemeCore = Record<CoreKey, string>;

/** What is persisted (main/themeSettings.ts mirrors this shape): a preset plus per-color overrides on top of it. */
export type ThemeSettings = { presetId: string; overrides: Partial<ThemeCore> };

export const DEFAULT_PRESET_ID = "warm-dark";
export const DEFAULT_THEME: ThemeSettings = { presetId: DEFAULT_PRESET_ID, overrides: {} };

/** Message keys; translate where drawn. */
export const CORE_LABELS: Record<CoreKey, MessageKey> = {
  bg: "theme.core.bg",
  surface: "theme.core.surface",
  text: "theme.core.text",
  accent: "theme.core.accent",
};
