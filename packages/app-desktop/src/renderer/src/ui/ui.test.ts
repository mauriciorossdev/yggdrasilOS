import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FEATURE_STATUSES } from "../documents/featureDoc.js";
import { STATUS_TONE, statusTone } from "./Chip.js";

const uiDir = fileURLToPath(new URL(".", import.meta.url));
const css = readFileSync(`${uiDir}ui.css`, "utf8");

describe("ui library", () => {
  it("styles only with tokens (no raw hex colors in ui.css)", () => {
    expect(css.match(/#[0-9a-fA-F]{3,8}(?![0-9a-fA-F])/g) ?? []).toEqual([]);
  });

  it("defines every ygg-* class its components use", () => {
    const used = new Set<string>();
    for (const file of readdirSync(uiDir).filter((f) => f.endsWith(".tsx"))) {
      const source = readFileSync(`${uiDir}${file}`, "utf8");
      for (const m of source.matchAll(/(?<!-)ygg-[a-z0-9_-]+/g)) used.add(m[0]);
    }
    // Classes assembled from a prefix + variant (ygg-btn--${variant} ...) are checked by their known variants.
    const dynamic = [
      ...["primary", "secondary", "ghost", "danger"].map((v) => `ygg-btn--${v}`),
      ...["sm", "md"].map((s) => `ygg-btn--${s}`),
      ...["neutral", "accent", "working", "checking", "ready", "attention", "danger"].map((t) => `ygg-chip--${t}`),
      ...["working", "checking", "ready", "danger"].map((t) => `ygg-progress--${t}`),
    ];
    const missing = [...used, ...dynamic].filter((cls) => !cls.endsWith("-") && !css.includes(`.${cls}`));
    expect(missing).toEqual([]);
  });

  it("maps every feature status to a chip tone", () => {
    for (const status of FEATURE_STATUSES) expect(STATUS_TONE[status]).toBeTruthy();
    expect(statusTone(null)).toBe("neutral");
    expect(statusTone("needs-decision")).toBe("attention");
  });
});
