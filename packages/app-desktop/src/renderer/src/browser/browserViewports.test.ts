import { describe, expect, it } from "vitest";
import { findViewportPreset, fitViewport, VIEWPORT_PRESETS, uncoveredWidth } from "./browserViewports.js";

describe("fitViewport", () => {
  const iphone = VIEWPORT_PRESETS.find((p) => p.id === "iphone")!;
  it("keeps 1:1 when the area is larger", () => {
    expect(fitViewport(iphone, { width: 1000, height: 1000 })).toEqual({ scale: 1, width: 390, height: 844 });
  });
  it("scales down by the tighter axis", () => {
    const fit = fitViewport(iphone, { width: 1000, height: 422 });
    expect(fit.scale).toBeCloseTo(0.5, 5);
    expect(fit.height).toBe(422);
  });
  it("survives a zero-size area", () => {
    expect(fitViewport(iphone, { width: 0, height: 0 }).scale).toBe(1);
  });
  it("finds presets by id", () => {
    expect(findViewportPreset("tablet")?.width).toBe(768);
    expect(findViewportPreset("nope")).toBeNull();
  });
});

describe("uncoveredWidth", () => {
  const area = { x: 240, width: 1040 };

  it("is the whole area when nothing covers it", () => {
    expect(uncoveredWidth(area, 1280, 0)).toBe(1040);
  });

  it("stops where the panel starts", () => {
    expect(uncoveredWidth(area, 1280, 772)).toBe(268);
  });

  it("ignores a panel that doesn't reach the area", () => {
    expect(uncoveredWidth({ x: 240, width: 600 }, 1280, 100)).toBe(600);
  });

  it("never reaches 0, even under a panel wider than the area", () => {
    expect(uncoveredWidth(area, 1280, 1200)).toBe(1);
  });
});
