import { readSettingsFile, updateSettingsFile } from "./settingsFile.js";

// Mirrors renderer/src/ui/theme/types.ts (main and renderer have separate
// tsconfigs, same convention as ProjectRecord/PaneNode). Only the preset id and
// four optional #rrggbb overrides are ever stored.
export type ThemeSettings = {
  presetId: string;
  overrides: Partial<Record<"bg" | "surface" | "text" | "accent", string>>;
};

const CORE_KEYS = ["bg", "surface", "text", "accent"] as const;
const DEFAULT_PRESET_ID = "warm-dark";

export function defaultThemeSettings(): ThemeSettings {
  return { presetId: DEFAULT_PRESET_ID, overrides: {} };
}

/** Whatever the renderer or an old settings file hands us, reduced to a safe ThemeSettings. */
export function sanitizeThemeSettings(raw: unknown): ThemeSettings {
  const input = (raw ?? {}) as { presetId?: unknown; overrides?: unknown };
  const presetId =
    typeof input.presetId === "string" && /^[a-z0-9-]{1,40}$/.test(input.presetId) ? input.presetId : DEFAULT_PRESET_ID;
  const overrides: ThemeSettings["overrides"] = {};
  const given = (input.overrides ?? {}) as Record<string, unknown>;
  for (const key of CORE_KEYS) {
    const value = given[key];
    if (typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)) overrides[key] = value.toLowerCase();
  }
  return { presetId, overrides };
}

/** desktop-settings.json also holds the theme (nested under "theme") — see settingsFile.ts's shared write queue. */
export async function loadThemeSettings(userDataDir: string): Promise<ThemeSettings> {
  const raw = await readSettingsFile(userDataDir);
  return sanitizeThemeSettings((raw as { theme?: unknown }).theme);
}

export async function saveThemeSettings(userDataDir: string, settings: ThemeSettings): Promise<ThemeSettings> {
  const clean = sanitizeThemeSettings(settings);
  await updateSettingsFile(userDataDir, (existing) => ({ ...existing, theme: clean }));
  return clean;
}
