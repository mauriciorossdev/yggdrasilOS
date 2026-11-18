import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({}));

const { scaleBrowserTabBounds } = await import("./browserTabView.js");

describe("scaleBrowserTabBounds", () => {
  it("leaves bounds alone at 100%", () => {
    const b = { x: 300, y: 140, width: 1095, height: 890 };
    expect(scaleBrowserTabBounds(b, 1)).toBe(b);
  });

  it("scales position, size and crop by the host zoom, not the device size", () => {
    const b = {
      x: 240,
      y: 112,
      width: 876,
      height: 712,
      crop: { width: 900, height: 712 },
      emulate: { width: 390, height: 844, mobile: true },
    };
    expect(scaleBrowserTabBounds(b, 1.25)).toEqual({
      x: 300,
      y: 140,
      width: 1095,
      height: 890,
      crop: { width: 1125, height: 890 },
      emulate: { width: 390, height: 844, mobile: true },
    });
  });

  it("ignores a bad zoom", () => {
    const b = { x: 1, y: 2, width: 3, height: 4 };
    expect(scaleBrowserTabBounds(b, 0)).toBe(b);
    expect(scaleBrowserTabBounds(b, Number.NaN)).toBe(b);
  });
});
