import { describe, expect, it } from "vitest";
import { contrastRatio, isHexColor, mixHex, readableOn } from "./color.js";

describe("color helpers", () => {
  it("accepts only #rrggbb", () => {
    expect(isHexColor("#1a1918")).toBe(true);
    expect(isHexColor("#FFF")).toBe(false);
    expect(isHexColor("red")).toBe(false);
    expect(isHexColor(undefined)).toBe(false);
  });

  it("mixes in sRGB", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHex("#102030", "#102030", 0.7)).toBe("#102030");
  });

  it("computes WCAG contrast", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
  });

  it("picks a readable foreground for an accent", () => {
    expect(readableOn("#ffd54a")).toBe("#111111");
    expect(readableOn("#1a2a6c")).toBe("#ffffff");
  });
});
