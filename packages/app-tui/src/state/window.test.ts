import { describe, expect, it } from "vitest";
import { visibleWindow } from "./window.js";

describe("visibleWindow", () => {
  it("shows everything when it fits", () => {
    expect(visibleWindow(3, 2, 10)).toEqual({ start: 0, end: 3 });
  });
  it("centers the selection", () => {
    expect(visibleWindow(100, 50, 10)).toEqual({ start: 45, end: 55 });
  });
  it("clamps at both ends", () => {
    expect(visibleWindow(100, 0, 10)).toEqual({ start: 0, end: 10 });
    expect(visibleWindow(100, 99, 10)).toEqual({ start: 90, end: 100 });
  });
});
