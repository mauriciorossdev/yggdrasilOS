import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { argbToHex, hexToArgb, newSnapshot, snapshotToXlsx, xlsxToSnapshot } from "./convert.js";

/** A small but realistic workbook: header row, numbers, a formula with a cached result, a date, styles, a merge. */
async function sampleXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Budget");
  ws.mergeCells("A1:C1");
  ws.getCell("A1").value = "Q4 Budget";
  ws.getCell("A1").font = { bold: true, size: 14, color: { argb: "FF1F4E79" } };
  ws.getCell("A1").alignment = { horizontal: "center" };
  ws.addRow(["Item", "Cost", "Share"]);
  ws.getRow(2).font = { bold: true };
  ws.getRow(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDEBF7" } };
  ws.addRow(["Hosting", 120.5, { formula: "B3/B5", result: 0.4 }]);
  ws.addRow(["Licenses", 180, { formula: "B4/B5", result: 0.6 }]);
  ws.addRow(["Total", { formula: "SUM(B3:B4)", result: 300.5 }, true]);
  ws.getCell("C3").numFmt = "0.0%";
  ws.getCell("A7").value = new Date(Date.UTC(2026, 10, 18));
  ws.getColumn(1).width = 18;
  ws.getRow(2).height = 24;
  ws.views = [{ state: "frozen", ySplit: 2 }];
  const second = wb.addWorksheet("Notes");
  second.getCell("A1").value = "Second sheet";
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("xlsxToSnapshot", () => {
  it("reads sheets in order with their names", async () => {
    const snap = await xlsxToSnapshot(await sampleXlsx(), "Budget.xlsx");
    expect(snap.sheetOrder.map((id) => snap.sheets[id]!.name)).toEqual(["Budget", "Notes"]);
    expect(snap.name).toBe("Budget.xlsx");
  });

  it("keeps values, types and formulas with their cached results", async () => {
    const snap = await xlsxToSnapshot(await sampleXlsx());
    const sheet = snap.sheets[snap.sheetOrder[0]!]!;
    expect(sheet.cellData[1]![0]).toMatchObject({ v: "Item", t: 1 });
    expect(sheet.cellData[2]![1]).toMatchObject({ v: 120.5, t: 2 });
    expect(sheet.cellData[2]![2]).toMatchObject({ f: "=B3/B5", v: 0.4 });
    expect(sheet.cellData[4]![1]).toMatchObject({ f: "=SUM(B3:B4)", v: 300.5 });
    expect(sheet.cellData[4]![2]).toMatchObject({ v: true, t: 3 });
  });

  it("turns dates into Excel serial numbers", async () => {
    const snap = await xlsxToSnapshot(await sampleXlsx());
    const cell = snap.sheets[snap.sheetOrder[0]!]!.cellData[6]![0]!;
    expect(cell.t).toBe(2);
    expect(cell.v).toBeCloseTo(46344, 0); // 2026-11-18
  });

  it("maps styles to shared style ids", async () => {
    const snap = await xlsxToSnapshot(await sampleXlsx());
    const sheet = snap.sheets[snap.sheetOrder[0]!]!;
    const title = snap.styles[sheet.cellData[0]![0]!.s as string]!;
    expect(title).toMatchObject({ bl: 1, fs: 14, cl: { rgb: "#1F4E79" }, ht: 2 });
    const header = snap.styles[sheet.cellData[1]![0]!.s as string]!;
    expect(header).toMatchObject({ bl: 1, bg: { rgb: "#DDEBF7" } });
    expect(snap.styles[sheet.cellData[2]![2]!.s as string]).toMatchObject({ n: { pattern: "0.0%" } });
    // The header row's cells share one style entry instead of repeating it.
    expect(sheet.cellData[1]![0]!.s).toBe(sheet.cellData[1]![1]!.s);
  });

  it("reads merges, column widths, row heights and frozen panes", async () => {
    const snap = await xlsxToSnapshot(await sampleXlsx());
    const sheet = snap.sheets[snap.sheetOrder[0]!]!;
    expect(sheet.mergeData).toEqual([{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 2 }]);
    expect(sheet.columnData![0]!.w).toBe(Math.round(18 * 7 + 5));
    expect(sheet.rowData![1]!.h).toBe(32);
    expect(sheet.freeze).toMatchObject({ ySplit: 2 });
  });

  it("leaves room around the data", async () => {
    const snap = await xlsxToSnapshot(await sampleXlsx());
    const sheet = snap.sheets[snap.sheetOrder[0]!]!;
    expect(sheet.rowCount).toBeGreaterThanOrEqual(200);
    expect(sheet.columnCount).toBeGreaterThanOrEqual(26);
  });
});

describe("round trip", () => {
  it("survives snapshot → xlsx → snapshot for values, formulas, styles, merges and sizes", async () => {
    const first = await xlsxToSnapshot(await sampleXlsx());
    const second = await xlsxToSnapshot(await snapshotToXlsx(first));
    const a = first.sheets[first.sheetOrder[0]!]!;
    const b = second.sheets[second.sheetOrder[0]!]!;
    expect(b.name).toBe("Budget");
    expect(b.mergeData).toEqual(a.mergeData);
    expect(b.columnData![0]!.w).toBe(a.columnData![0]!.w);
    expect(b.freeze).toMatchObject({ ySplit: 2 });
    for (const [r, cols] of Object.entries(a.cellData)) {
      for (const [c, cell] of Object.entries(cols)) {
        const other = b.cellData[r]?.[c];
        expect(other?.v, `value at ${r},${c}`).toEqual(cell.v);
        expect(other?.f ?? null, `formula at ${r},${c}`).toEqual(cell.f ?? null);
        expect(second.styles[other?.s as string] ?? null, `style at ${r},${c}`).toEqual(first.styles[cell.s as string] ?? null);
      }
    }
    expect(second.sheetOrder.map((id) => second.sheets[id]!.name)).toEqual(["Budget", "Notes"]);
  });
});

describe("newSnapshot", () => {
  it("builds a sheet from rows, with formulas for strings starting with =", async () => {
    const snap = newSnapshot("Mine", [["a", 1], ["=B1*2", null]]);
    const sheet = snap.sheets["sheet-1"]!;
    expect(sheet.cellData[0]![1]).toMatchObject({ v: 1, t: 2 });
    expect(sheet.cellData[1]![0]).toMatchObject({ f: "=B1*2" });
    expect(sheet.cellData[1]![1]).toBeUndefined();
    const reread = await xlsxToSnapshot(await snapshotToXlsx(snap));
    expect(reread.sheets[reread.sheetOrder[0]!]!.cellData[1]![0]).toMatchObject({ f: "=B1*2" });
  });
});

describe("colour helpers", () => {
  it("converts between ARGB and #RRGGBB", () => {
    expect(argbToHex("FF3366CC")).toBe("#3366CC");
    expect(argbToHex("bad")).toBeUndefined();
    expect(hexToArgb("#3366cc")).toBe("FF3366CC");
    expect(hexToArgb(null)).toBeUndefined();
  });
});

describe("borders", () => {
  it("reads each side with its style and colour and writes it back", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("B");
    ws.getCell("B2").value = "x";
    ws.getCell("B2").border = {
      top: { style: "thin", color: { argb: "FFFF0000" } },
      bottom: { style: "double" },
      left: { style: "medium", color: { argb: "FF00FF00" } },
    };
    const snap = await xlsxToSnapshot(Buffer.from(await wb.xlsx.writeBuffer()));
    const sheet = snap.sheets[snap.sheetOrder[0]!]!;
    const style = snap.styles[sheet.cellData[1]![1]!.s as string]!;
    expect(style.bd).toEqual({
      t: { s: 1, cl: { rgb: "#FF0000" } },
      b: { s: 7, cl: { rgb: "#000000" } },
      l: { s: 8, cl: { rgb: "#00FF00" } },
    });
    const back = new ExcelJS.Workbook();
    await back.xlsx.load((await snapshotToXlsx(snap)) as unknown as ArrayBuffer);
    const border = back.worksheets[0]!.getCell("B2").border!;
    expect(border.top).toMatchObject({ style: "thin", color: { argb: "FFFF0000" } });
    expect(border.bottom?.style).toBe("double");
    expect(border.left).toMatchObject({ style: "medium", color: { argb: "FF00FF00" } });
    expect(border.right).toBeUndefined();
  });
});
