import ExcelJS from "exceljs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { inspectLossyFeatures } from "./inspect.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

async function build(fn: (wb: ExcelJS.Workbook, ws: ExcelJS.Worksheet) => void): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("S");
  fn(wb, ws);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/** Adds a raw part to a valid xlsx, to stand in for features ExcelJS can't create. */
async function withPart(data: Uint8Array, name: string, content: string): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(data);
  zip.file(name, content);
  return zip.generateAsync({ type: "uint8array" });
}

describe("inspectLossyFeatures", () => {
  it("reports nothing for features the patching save carries through untouched", async () => {
    const data = await build((wb, ws) => {
      ws.getCell("A1").value = "x";
      ws.getCell("A1").border = { top: { style: "thin" } };
      ws.getCell("A2").value = { text: "t", hyperlink: "https://example.com" };
      ws.getCell("A3").dataValidation = { type: "whole", operator: "between", formulae: [1, 5] };
      ws.addConditionalFormatting({ ref: "A1", rules: [{ type: "cellIs", operator: "greaterThan", formulae: [0], priority: 1, style: { font: { bold: true } } }] });
      ws.addImage(wb.addImage({ buffer: PNG as unknown as ExcelJS.Buffer, extension: "png" }), "D1:E3");
    });
    expect(await inspectLossyFeatures(data)).toEqual([]);
  });

  it("names the features that would be lost", async () => {
    let data = await build((_wb, ws) => (ws.getCell("A1").value = 1));
    data = await withPart(data, "xl/charts/chart1.xml", "<c:chartSpace/>");
    data = await withPart(data, "xl/pivotTables/pivotTable1.xml", "<pivotTableDefinition/>");
    data = await withPart(data, "xl/slicers/slicer1.xml", "<slicers/>");
    data = await withPart(data, "xl/comments1.xml", "<comments/>");
    data = await withPart(data, "xl/drawings/drawing1.xml", "<xdr:wsDr><xdr:twoCellAnchor><xdr:sp/></xdr:twoCellAnchor></xdr:wsDr>");
    data = await withPart(data, "xl/worksheets/sheet9.xml", "<worksheet><extLst><x14:sparklineGroups/></extLst></worksheet>");
    expect((await inspectLossyFeatures(data)).sort()).toEqual(["charts", "comments", "pivot tables", "shapes", "slicers", "sparklines"]);
  });
});
