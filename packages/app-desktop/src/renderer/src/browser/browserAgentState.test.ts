import { describe, expect, it } from "vitest";
import { clampDockWidth, DEFAULT_DOCK_WIDTH, DEFAULT_PREFS, MIN_DOCK_WIDTH, parsePrefs } from "./browserAgentState.js";

describe("parsePrefs", () => {
  it("defaults on missing or broken input", () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("{nope")).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('"str"')).toEqual(DEFAULT_PREFS);
  });
  it("reads valid values and sanitizes the rest", () => {
    expect(parsePrefs('{"dockedId":"a","open":true,"width":500}')).toEqual({ dockedId: "a", open: true, width: 500 });
    expect(parsePrefs('{"dockedId":5,"open":"yes","width":"wide"}')).toEqual({ dockedId: null, open: false, width: DEFAULT_DOCK_WIDTH });
    expect(parsePrefs('{"width":10}').width).toBe(MIN_DOCK_WIDTH);
  });
});

describe("clampDockWidth", () => {
  it("keeps it between the minimum and 60% of the container", () => {
    expect(clampDockWidth(100, 1500)).toBe(MIN_DOCK_WIDTH);
    expect(clampDockWidth(5000, 1500)).toBe(900);
    expect(clampDockWidth(450, 1500)).toBe(450);
  });
  it("never goes below the minimum even in a tiny window", () => {
    expect(clampDockWidth(500, 300)).toBe(MIN_DOCK_WIDTH);
  });
});
