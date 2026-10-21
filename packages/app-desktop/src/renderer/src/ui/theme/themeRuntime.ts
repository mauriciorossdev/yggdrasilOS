import { DEFAULT_THEME, type ThemeCore, type ThemeSettings } from "./types.js";
import { resolveCore, themeToCssVars } from "./resolve.js";

// Applies a theme to this window and tells the surfaces that cannot read CSS
// variables (xterm, Monaco) to re-tone. Module-level pub/sub, same shape as
// terminal/usePaneSpec.ts, so those surfaces don't need a React context.

let current: ThemeCore = resolveCore(DEFAULT_THEME);
const listeners = new Set<(core: ThemeCore) => void>();

export function applyTheme(settings: ThemeSettings): void {
  const root = document.documentElement.style;
  for (const [name, value] of Object.entries(themeToCssVars(settings))) root.setProperty(name, value);
  current = resolveCore(settings);
  listeners.forEach((fn) => fn(current));
}

export function getThemeColors(): ThemeCore {
  return current;
}

/** Calls `fn` on every theme change (not on subscribe); returns an unsubscribe. */
export function onThemeApplied(fn: (core: ThemeCore) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
