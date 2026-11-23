import { applyTheme, DEFAULT_THEME, PRESETS, type ThemeCore, type ThemeSettings } from "@yggdrasil/ui-kit";

/**
 * The console's theme: one of the desktop app's presets, or the console's own light theme,
 * remembered per browser. The light theme lives here, not in the kit: the kit's presets
 * also feed the desktop app's theme picker, and the app isn't styled for a light background.
 */
const STORAGE_KEY = "yggdrasil.console.theme";
export const LIGHT_ID = "light";

/** Core colors of the light theme; styles.css (`[data-console-theme="light"]`) re-tones the derived tokens. */
export const LIGHT_CORE: ThemeCore = { bg: "#f6f5f1", surface: "#ffffff", text: "#1f1e1c", accent: "#b4532f" };

export function isKnownTheme(id: string): boolean {
  return id === LIGHT_ID || PRESETS.some((p) => p.id === id);
}

export function savedPresetId(): string {
  try {
    const id = localStorage.getItem(STORAGE_KEY);
    if (id && isKnownTheme(id)) return id;
  } catch {
    // Storage blocked: use the default.
  }
  return DEFAULT_THEME.presetId;
}

/** Theme settings for an id: kit presets as-is; light as overrides on top of the default preset. */
export function themeSettingsFor(presetId: string): ThemeSettings {
  if (presetId === LIGHT_ID) return { ...DEFAULT_THEME, overrides: { ...LIGHT_CORE } };
  return { ...DEFAULT_THEME, presetId };
}

export function applyPreset(presetId: string): void {
  applyTheme(themeSettingsFor(presetId));
  if (presetId === LIGHT_ID) document.documentElement.dataset.consoleTheme = "light";
  else delete document.documentElement.dataset.consoleTheme;
  try {
    localStorage.setItem(STORAGE_KEY, presetId);
  } catch {
    // Not remembered; still applied for this visit.
  }
}
