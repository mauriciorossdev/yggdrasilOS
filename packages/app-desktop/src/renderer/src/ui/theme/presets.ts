import type { ThemeCore } from "./types.js";

export type ThemePreset = { id: string; name: string; core: ThemeCore };

export const PRESETS: ThemePreset[] = [
  {
    id: "warm-dark",
    name: "Warm dark",
    core: { bg: "#1a1918", surface: "#262523", text: "#f1efe7", accent: "#d97757" },
  },
  {
    id: "slate-dark",
    name: "Slate dark",
    core: { bg: "#14161a", surface: "#1c1f24", text: "#e6e6e6", accent: "#6ea8e0" },
  },
  {
    id: "high-contrast",
    name: "Alto contraste",
    core: { bg: "#000000", surface: "#121212", text: "#ffffff", accent: "#ffd54a" },
  },
];

export function findPreset(id: string): ThemePreset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0]!;
}
