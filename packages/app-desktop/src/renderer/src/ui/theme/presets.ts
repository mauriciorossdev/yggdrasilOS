import type { MessageKey } from "../../i18n/index.js";
import type { ThemeCore } from "./types.js";

/** `name` is a message key; translate where drawn. */
export type ThemePreset = { id: string; name: MessageKey; core: ThemeCore };

export const PRESETS: ThemePreset[] = [
  {
    id: "warm-dark",
    name: "theme.preset.warmDark",
    core: { bg: "#1a1918", surface: "#262523", text: "#f1efe7", accent: "#d97757" },
  },
  {
    id: "slate-dark",
    name: "theme.preset.slateDark",
    core: { bg: "#14161a", surface: "#1c1f24", text: "#e6e6e6", accent: "#6ea8e0" },
  },
  {
    id: "high-contrast",
    name: "theme.preset.highContrast",
    core: { bg: "#000000", surface: "#121212", text: "#ffffff", accent: "#ffd54a" },
  },
];

export function findPreset(id: string): ThemePreset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0]!;
}
