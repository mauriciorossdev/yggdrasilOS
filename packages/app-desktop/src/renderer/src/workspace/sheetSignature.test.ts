import type { WorkbookSnapshot } from "@yggdrasil/tool-office";
import { describe, expect, it } from "vitest";
import { contentSignature } from "./sheetSignature.js";

const base = (): WorkbookSnapshot => ({
  id: "w",
  name: "w",
  appVersion: "1",
  locale: "enUS",
  styles: { s1: { bl: 1 } },
  sheetOrder: ["a"],
  sheets: { a: { id: "a", name: "Sheet1", rowCount: 200, columnCount: 26, cellData: { 0: { 0: { v: 1, t: 2 } } } } },
});

describe("contentSignature", () => {
  it("is stable across view-only changes", () => {
    const a = base();
    const b = base();
    b.sheets.a!.scrollTop = 120;
    b.sheets.a!.zoomRatio = 1.5;
    b.sheets.a!.rowData = { 0: { h: 40 } };
    b.id = "other";
    expect(contentSignature(b)).toBe(contentSignature(a));
  });
  it("changes with a value, a style, a merge, a width or a sheet name", () => {
    const sig = contentSignature(base());
    const edits: Array<(s: WorkbookSnapshot) => void> = [
      (s) => (s.sheets.a!.cellData[0]![0]!.v = 2),
      (s) => (s.styles.s1 = { bl: 0 }),
      (s) => (s.sheets.a!.mergeData = [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 }]),
      (s) => (s.sheets.a!.columnData = { 0: { w: 90 } }),
      (s) => (s.sheets.a!.name = "Renamed"),
    ];
    for (const edit of edits) {
      const s = base();
      edit(s);
      expect(contentSignature(s)).not.toBe(sig);
    }
  });
});
