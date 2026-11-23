import { describe, expect, it } from "vitest";
import { contrastRatio } from "./color.js";
import { PRESETS } from "./presets.js";
import { resolveCore, themeToCssVars, themeWarnings } from "./resolve.js";
import { monacoThemeData, terminalColors } from "./surfaces.js";
import { DEFAULT_THEME } from "./types.js";

describe("resolveCore", () => {
  it("falls back to the default preset for an unknown id", () => {
    expect(resolveCore({ presetId: "nope", overrides: {} })).toEqual(PRESETS[0]!.core);
  });

  it("applies valid overrides and ignores invalid ones", () => {
    const core = resolveCore({ presetId: "warm-dark", overrides: { accent: "#00FF88", bg: "blue" } });
    expect(core.accent).toBe("#00ff88");
    expect(core.bg).toBe(PRESETS[0]!.core.bg);
  });
});

describe("themeToCssVars", () => {
  it("emits the core colors and a readable accent foreground", () => {
    const vars = themeToCssVars(DEFAULT_THEME);
    expect(vars["--ygg-bg"]).toBe("#1a1918");
    expect(vars["--ygg-accent"]).toBe("#d97757");
    expect(contrastRatio(vars["--ygg-accent"]!, vars["--ygg-accent-fg"]!)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("presets", () => {
  it.each(PRESETS.map((p) => [p.id, p.core] as const))("%s is readable", (_id, core) => {
    expect(themeWarnings(core)).toEqual([]);
  });
});

describe("themeWarnings", () => {
  it("flags low contrast", () => {
    const warnings = themeWarnings({ bg: "#222222", surface: "#262626", text: "#2a2a2a", accent: "#232323" });
    expect(warnings).toHaveLength(3);
  });
});

describe("surface colors", () => {
  it("derives xterm and Monaco colors from the core", () => {
    const core = PRESETS[0]!.core;
    expect(terminalColors(core).foreground).toBe(core.text);
    expect(terminalColors(core).cursor).toBe(core.accent);
    expect(monacoThemeData(core).colors["editor.foreground"]).toBe(core.text);
  });
});
