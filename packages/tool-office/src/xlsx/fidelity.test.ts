import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { snapshotToXlsx, xlsxToSnapshot } from "./convert.js";

/**
 * What a round trip through the in-app editor does NOT keep. These tests pin the known limits so they are
 * visible and a future improvement shows up as a deliberate change here, instead of a surprise in a user's file.
 */
async function hardWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Hard");
  ws.getCell("A1").value = "bordered";
  ws.getCell("A1").border = { top: { style: "thin" }, bottom: { style: "double" } };
  ws.getCell("A2").value = { text: "site", hyperlink: "https://example.com" };
  ws.getCell("A3").value = 5;
  ws.getCell("A3").dataValidation = { type: "whole", operator: "between", formulae: [1, 10], allowBlank: true };
  ws.addConditionalFormatting({ ref: "A3", rules: [{ type: "cellIs", operator: "greaterThan", formulae: [3], priority: 1, style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFF0000" } } } }] });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("known round-trip limits", () => {
  it("keeps values, formulas and borders but drops hyperlinks, validation and conditional formatting when regenerating", async () => {
    const snap = await xlsxToSnapshot(await hardWorkbook());
    const out = new ExcelJS.Workbook();
    await out.xlsx.load((await snapshotToXlsx(snap)) as unknown as ArrayBuffer);
    const ws = out.worksheets[0]!;
    // kept
    expect(ws.getCell("A1").value).toBe("bordered");
    expect(ws.getCell("A3").value).toBe(5);
    // lost when the file is rebuilt from the editor's snapshot (saving patches the original instead, see patch.ts)
    expect(ws.getCell("A1").border?.top?.style).toBe("thin");
    expect(ws.getCell("A1").border?.bottom?.style).toBe("double");
    expect(ws.getCell("A2").value).toBe("site"); // the text survives, the link does not
    expect(ws.getCell("A3").dataValidation).toBeUndefined();
    expect(((ws.model as unknown as { conditionalFormattings?: unknown[] }).conditionalFormattings ?? []).length).toBe(0);
  });
});
