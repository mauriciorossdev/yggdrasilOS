import { describe, expect, it } from "vitest";
import { PRESETS, resolveCore, themeWarnings } from "@yggdrasil/ui-kit";
import { isKnownTheme, LIGHT_CORE, LIGHT_ID, themeSettingsFor } from "./theme";

describe("console themes", () => {
  it("knows the kit presets plus its own light theme, which the kit doesn't list", () => {
    for (const p of PRESETS) expect(isKnownTheme(p.id)).toBe(true);
    expect(isKnownTheme(LIGHT_ID)).toBe(true);
    expect(isKnownTheme("nope")).toBe(false);
    expect(PRESETS.some((p) => p.id === LIGHT_ID)).toBe(false);
  });

  it("light resolves to its own colors, readable (same checks as the app's theme settings)", () => {
    const core = resolveCore(themeSettingsFor(LIGHT_ID));
    expect(core).toEqual(LIGHT_CORE);
    expect(themeWarnings(core)).toEqual([]);
  });

  it("a kit preset is used as-is", () => {
    expect(themeSettingsFor("slate-dark")).toEqual({ presetId: "slate-dark", overrides: {} });
  });
});
