import { mixHex } from "./color.js";
import type { ThemeCore } from "./types.js";

// Colors for the surfaces that cannot read CSS variables themselves (xterm and
// Monaco take plain color strings), derived from the same four core colors.

export function terminalColors(core: ThemeCore) {
  return {
    background: mixHex(core.bg, core.surface, 0.4),
    foreground: core.text,
    cursor: core.accent,
    cursorAccent: core.bg,
    selectionBackground: mixHex(core.bg, core.accent, 0.4),
  };
}

export function monacoThemeData(core: ThemeCore) {
  return {
    base: "vs-dark" as const,
    inherit: true,
    rules: [],
    colors: {
      "editor.background": mixHex(core.bg, core.surface, 0.4),
      "editor.foreground": core.text,
      "editorLineNumber.foreground": mixHex(core.bg, core.text, 0.4),
      "editorLineNumber.activeForeground": core.text,
      "editorCursor.foreground": core.accent,
      "editor.selectionBackground": mixHex(core.bg, core.accent, 0.4),
      "editor.lineHighlightBackground": mixHex(core.bg, core.surface, 0.7),
      "editorWidget.background": core.surface,
      "diffEditor.insertedTextBackground": "#8fd19e22",
      "diffEditor.removedTextBackground": "#e0715c22",
    },
  };
}
