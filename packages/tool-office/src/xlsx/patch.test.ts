import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { xlsxToSnapshot } from "./convert.js";
import { patchXlsx } from "./patch.js";
import type { WorkbookSnapshot } from "./snapshot.js";

// A 1x1 transparent PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

/** A workbook with things the editor does not model, plus plain data to edit. */
async function richWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Report");
  ws.getCell("A1").value = "Header";
  ws.getCell("A1").border = { bottom: { style: "medium" } };
  ws.getCell("A1").font = { bold: true };
  ws.getCell("A2").value = { text: "site", hyperlink: "https://example.com" };
  ws.getCell("A3").value = 5;
  ws.getCell("B3").value = { formula: "A3*2", result: 10 };
  ws.getCell("A5").dataValidation = { type: "whole", operator: "between", formulae: [1, 10], allowBlank: true };
  ws.addConditionalFormatting({ ref: "A3", rules: [{ type: "cellIs", operator: "greaterThan", formulae: [3], priority: 1, style: { font: { bold: true } } }] });
  ws.getCell("A4").value = "noted";
  ws.getCell("A4").note = "a comment";
  ws.mergeCells("D1:E1");
  ws.getColumn(1).width = 20;
  const imageId = wb.addImage({ buffer: PNG as unknown as ExcelJS.Buffer, extension: "png" });
  ws.addImage(imageId, "G2:H4");
  wb.addWorksheet("Other").getCell("A1").value = "keep me";
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const clone = (s: WorkbookSnapshot): WorkbookSnapshot => JSON.parse(JSON.stringify(s));
const reload = async (buf: Buffer) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
};

describe("patchXlsx", () => {
  it("changes only the edited cell and leaves what the editor doesn't model intact", async () => {
    const original = await richWorkbook();
    const base = await xlsxToSnapshot(original);
    const current = clone(base);
    const sheet = current.sheets[current.sheetOrder[0]!]!;
    sheet.cellData[2]![0] = { v: 7, t: 2 }; // A3: 5 → 7
    sheet.cellData[2]![1] = { f: "=A3*2", v: 14, t: 2 }; // B3's cached result follows

    const wb = await reload(await patchXlsx(original, base, current));
    const ws = wb.getWorksheet("Report")!;
    expect(ws.getCell("A3").value).toBe(7);
    expect(ws.getCell("B3").value).toMatchObject({ formula: "A3*2", result: 14 });
    // untouched, and not modelled by the editor:
    expect(ws.getCell("A1").border?.bottom?.style).toBe("medium");
    expect(ws.getCell("A2").value).toMatchObject({ text: "site", hyperlink: "https://example.com" });
    expect(ws.getCell("A5").dataValidation?.type).toBe("whole");
    expect(((ws.model as unknown as { conditionalFormattings?: unknown[] }).conditionalFormattings ?? []).length).toBe(1);
    expect(ws.getCell("A4").note).toBeTruthy();
    expect(ws.getImages().length).toBe(1);
    expect(wb.getWorksheet("Other")!.getCell("A1").value).toBe("keep me");
  });

  it("does not touch anything when nothing changed", async () => {
    const original = await richWorkbook();
    const base = await xlsxToSnapshot(original);
    const wb = await reload(await patchXlsx(original, base, clone(base)));
    const ws = wb.getWorksheet("Report")!;
    expect(ws.getCell("A2").value).toMatchObject({ hyperlink: "https://example.com" });
    expect(ws.getCell("A1").font?.bold).toBe(true);
    expect(ws.getColumn(1).width).toBe(20);
  });

  it("applies style, merge, width and clearing changes", async () => {
    const original = await richWorkbook();
    const base = await xlsxToSnapshot(original);
    const current = clone(base);
    const sheet = current.sheets[current.sheetOrder[0]!]!;
    current.styles.newStyle = { bl: 1, bg: { rgb: "#FFFF00" }, bd: { t: { s: 1, cl: { rgb: "#000000" } } } };
    sheet.cellData[2]![0]!.s = "newStyle"; // A3 gets a style
    delete sheet.cellData[3]![0]; // A4 cleared
    sheet.mergeData = [...(sheet.mergeData ?? []).filter((m) => m.startColumn !== 3), { startRow: 5, endRow: 5, startColumn: 0, endColumn: 2 }]; // D1:E1 unmerged, A6:C6 merged
    sheet.columnData = { ...sheet.columnData, 1: { w: 120 } };

    const ws = (await reload(await patchXlsx(original, base, current))).getWorksheet("Report")!;
    expect(ws.getCell("A3").font?.bold).toBe(true);
    expect(ws.getCell("A3").fill).toMatchObject({ fgColor: { argb: "FFFFFF00" } });
    expect(ws.getCell("A3").border?.top?.style).toBe("thin");
    expect(ws.getCell("A3").value).toBe(5); // value untouched by a style-only change
    expect(ws.getCell("A4").value).toBeNull();
    expect(ws.getCell("E1").isMerged && ws.getCell("D1").isMerged).toBe(false);
    expect(ws.getCell("B6").isMerged).toBe(true);
    expect(ws.getColumn(2).width).toBeCloseTo((120 - 5) / 7, 1);
    expect(ws.getCell("A1").border?.bottom?.style).toBe("medium"); // still intact
  });

  it("renames, adds and removes sheets", async () => {
    const original = await richWorkbook();
    const base = await xlsxToSnapshot(original);
    const current = clone(base);
    current.sheets[current.sheetOrder[0]!]!.name = "Summary";
    const otherId = current.sheetOrder[1]!;
    current.sheetOrder = [current.sheetOrder[0]!, "brand-new"];
    delete current.sheets[otherId];
    current.sheets["brand-new"] = { id: "brand-new", name: "Fresh", rowCount: 200, columnCount: 26, cellData: { 0: { 0: { v: "hello", t: 1 } } } };

    const wb = await reload(await patchXlsx(original, base, current));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "Fresh"]);
    expect(wb.getWorksheet("Fresh")!.getCell("A1").value).toBe("hello");
    expect(wb.getWorksheet("Summary")!.getCell("A2").value).toMatchObject({ hyperlink: "https://example.com" });
  });
});
