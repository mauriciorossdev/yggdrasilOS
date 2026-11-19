import { describe, expect, it } from "vitest";
import { assertReadable, MAX_CELLS, readResult, shapeOf, toCellWrite, toCellWrites } from "./sheetOps.js";

describe("toCellWrite", () => {
  it("types each kind of value, and treats a leading = as a formula", () => {
    expect(toCellWrite(3)).toEqual({ v: 3, t: 2 });
    expect(toCellWrite("hi")).toEqual({ v: "hi", t: 1 });
    expect(toCellWrite(true)).toEqual({ v: true, t: 3 });
    expect(toCellWrite("=SUM(A1:A3)")).toEqual({ f: "=SUM(A1:A3)" });
  });
  it("treats null and empty strings as an empty cell", () => {
    expect(toCellWrite(null)).toBeNull();
    expect(toCellWrite("")).toBeNull();
  });
  it("converts a whole grid", () => {
    expect(toCellWrites([[1, "=A1"], [null, "x"]])).toEqual([[{ v: 1, t: 2 }, { f: "=A1" }], [null, { v: "x", t: 1 }]]);
  });
});

describe("shapeOf", () => {
  it("returns the dimensions of a rectangular grid", () => {
    expect(shapeOf([[1, 2, 3], [4, 5, 6]])).toEqual({ rows: 2, columns: 3 });
  });
  it("rejects empty, ragged and oversized input", () => {
    expect(() => shapeOf([])).toThrow(/non-empty/);
    expect(() => shapeOf([[]])).toThrow(/at least one column/);
    expect(() => shapeOf([[1, 2], [3]])).toThrow(/same number of columns/);
    expect(() => shapeOf(Array.from({ length: MAX_CELLS + 1 }, () => [1]))).toThrow(/too many cells/);
  });
});

describe("read helpers", () => {
  it("refuses a range that is too large", () => {
    expect(() => assertReadable(100, 100)).toThrow(/range too large/);
    expect(() => assertReadable(10, 10)).not.toThrow();
  });
  it("shapes a read: empty cells are null and non-formula cells have no formula", () => {
    expect(readResult("A1:B2", [[1, ""], [undefined, "x"]], [["", ""], ["", "=A1"]])).toEqual({
      range: "A1:B2",
      values: [[1, null], [null, "x"]],
      formulas: [[null, null], [null, "=A1"]],
    });
  });
});
