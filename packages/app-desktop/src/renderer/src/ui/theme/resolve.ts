import { contrastRatio, isHexColor, readableOn } from "./color.js";
import { findPreset } from "./presets.js";
import { CORE_KEYS, type ThemeCore, type ThemeSettings } from "./types.js";

/** The preset's colors with the user's valid overrides applied on top. */
export function resolveCore(settings: ThemeSettings): ThemeCore {
  const core = { ...findPreset(settings.presetId).core };
  for (const key of CORE_KEYS) {
    const override = settings.overrides[key];
    if (isHexColor(override)) core[key] = override.toLowerCase();
  }
  return core;
}

/**
 * The inline custom properties to set on <html>. Only the four core colors and
 * the contrast-safe accent foreground are computed here; everything else is
 * derived by color-mix() in tokens.css.
 */
export function themeToCssVars(settings: ThemeSettings): Record<string, string> {
  const core = resolveCore(settings);
  return {
    "--ygg-bg": core.bg,
    "--ygg-surface": core.surface,
    "--ygg-text": core.text,
    "--ygg-accent": core.accent,
    "--ygg-accent-fg": readableOn(core.accent),
  };
}

/** Human-readable readability problems; shown in Settings, never blocking. */
export function themeWarnings(core: ThemeCore): string[] {
  const warnings: string[] = [];
  if (contrastRatio(core.text, core.bg) < 4.5) warnings.push("El texto casi no se distingue del fondo (contraste menor a 4.5).");
  if (contrastRatio(core.text, core.surface) < 4.5) warnings.push("El texto casi no se distingue de la superficie (contraste menor a 4.5).");
  if (contrastRatio(core.accent, core.bg) < 3) warnings.push("El acento casi no se distingue del fondo (contraste menor a 3).");
  return warnings;
}
