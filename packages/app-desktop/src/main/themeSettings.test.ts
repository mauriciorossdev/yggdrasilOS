import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultThemeSettings, loadThemeSettings, sanitizeThemeSettings, saveThemeSettings } from "./themeSettings.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function userData(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ygg-theme-"));
  dirs.push(dir);
  return dir;
}

describe("sanitizeThemeSettings", () => {
  it("falls back to the default for garbage", () => {
    expect(sanitizeThemeSettings(null)).toEqual(defaultThemeSettings());
    expect(sanitizeThemeSettings("x")).toEqual(defaultThemeSettings());
    expect(sanitizeThemeSettings({ presetId: "../../etc", overrides: 5 })).toEqual(defaultThemeSettings());
  });

  it("keeps only known keys with #rrggbb values, lowercased", () => {
    const clean = sanitizeThemeSettings({
      presetId: "slate-dark",
      overrides: { accent: "#FF8800", bg: "red", surface: "#12345", evil: "#000000", text: "#ffffff" },
    });
    expect(clean).toEqual({ presetId: "slate-dark", overrides: { accent: "#ff8800", text: "#ffffff" } });
  });
});

describe("theme persistence", () => {
  it("round-trips through desktop-settings.json without touching other keys", async () => {
    const dir = await userData();
    expect(await loadThemeSettings(dir)).toEqual(defaultThemeSettings());
    const saved = await saveThemeSettings(dir, { presetId: "high-contrast", overrides: { accent: "#00ff88" } });
    expect(saved.overrides.accent).toBe("#00ff88");
    expect(await loadThemeSettings(dir)).toEqual(saved);
  });
});
