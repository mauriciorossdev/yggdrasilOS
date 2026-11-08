import { describe, expect, it } from "vitest";
import { countMarkers, sortMarkers, SEVERITY_ERROR, SEVERITY_WARNING } from "./markers.js";

const marker = (severity: number, startLineNumber: number, startColumn = 1) => ({ severity, startLineNumber, startColumn, message: "m" });

describe("markers", () => {
  it("counts errors and warnings, ignoring info and hints", () => {
    expect(countMarkers([marker(SEVERITY_ERROR, 1), marker(SEVERITY_WARNING, 2), marker(SEVERITY_WARNING, 3), marker(2, 4), marker(1, 5)])).toEqual({
      errors: 1,
      warnings: 2,
    });
  });

  it("sorts worst first, then by position", () => {
    const sorted = sortMarkers([marker(SEVERITY_WARNING, 1), marker(SEVERITY_ERROR, 9, 4), marker(SEVERITY_ERROR, 9, 2), marker(SEVERITY_ERROR, 3)]);
    expect(sorted.map((m) => [m.severity, m.startLineNumber, m.startColumn])).toEqual([
      [SEVERITY_ERROR, 3, 1],
      [SEVERITY_ERROR, 9, 2],
      [SEVERITY_ERROR, 9, 4],
      [SEVERITY_WARNING, 1, 1],
    ]);
  });
});
