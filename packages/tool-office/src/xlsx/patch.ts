import ExcelJS from "exceljs";
import { applyStyle, COLUMN_PADDING_PX, PX_PER_CHAR, PX_PER_POINT, styleOf } from "./convert.js";
import type { CellData, MergeRange, SheetSnapshot, StyleData, WorkbookSnapshot } from "./snapshot.js";

/**
 * Saves the editor's changes INTO the original file instead of rebuilding it from the snapshot. The editor
 * only models part of what an .xlsx can hold, so a rebuild would silently drop the rest (conditional
 * formatting, data validation, hyperlinks, comments...). Patching changes only the cells, merges, sizes and
 * sheets that differ from the snapshot taken when the file was opened (`base`); everything else — including
 * whatever the editor doesn't understand, in cells nobody touched — stays exactly as it was.
 */

type Resolved = { v: CellData["v"]; f: string | null; style: StyleData | null };

function resolve(cell: CellData | undefined, styles: WorkbookSnapshot["styles"]): Resolved | null {
  if (!cell) return null;
  const style = styleOf(cell, styles) ?? null;
  const v = cell.v === undefined || cell.v === "" ? null : cell.v;
  const f = cell.f ?? null;
  if (v === null && f === null && !style) return null;
  return { v, f, style };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function mergeKey(m: MergeRange): string {
  return `${m.startRow}:${m.startColumn}:${m.endRow}:${m.endColumn}`;
}

function writeValue(target: ExcelJS.Cell, cell: Resolved): void {
  if (cell.f) target.value = { formula: cell.f.replace(/^=/, ""), result: (cell.v ?? undefined) as ExcelJS.CellFormulaValue["result"] };
  else target.value = cell.v === null ? null : cell.v;
}

function patchSheet(ws: ExcelJS.Worksheet, base: SheetSnapshot, current: SheetSnapshot, bs: WorkbookSnapshot["styles"], cs: WorkbookSnapshot["styles"]): void {
  if (current.name !== base.name) ws.name = current.name;

  const rows = new Set([...Object.keys(base.cellData ?? {}), ...Object.keys(current.cellData ?? {})]);
  for (const r of rows) {
    const cols = new Set([...Object.keys(base.cellData?.[r] ?? {}), ...Object.keys(current.cellData?.[r] ?? {})]);
    for (const c of cols) {
      const before = resolve(base.cellData?.[r]?.[c], bs);
      const after = resolve(current.cellData?.[r]?.[c], cs);
      if (same(before, after)) continue;
      const target = ws.getCell(Number(r) + 1, Number(c) + 1);
      if (!after) {
        target.value = null;
        target.style = {};
        continue;
      }
      if (!before || !same(before.v, after.v) || before.f !== after.f) writeValue(target, after);
      if (!before || !same(before.style, after.style)) {
        target.style = {};
        if (after.style) applyStyle(target, after.style);
      }
    }
  }

  const baseMerges = new Map((base.mergeData ?? []).map((m) => [mergeKey(m), m]));
  const currentMerges = new Map((current.mergeData ?? []).map((m) => [mergeKey(m), m]));
  for (const [key, m] of baseMerges) if (!currentMerges.has(key)) ws.unMergeCells(m.startRow + 1, m.startColumn + 1, m.endRow + 1, m.endColumn + 1);
  for (const [key, m] of currentMerges) if (!baseMerges.has(key)) ws.mergeCells(m.startRow + 1, m.startColumn + 1, m.endRow + 1, m.endColumn + 1);

  for (const c of new Set([...Object.keys(base.columnData ?? {}), ...Object.keys(current.columnData ?? {})])) {
    const before = base.columnData?.[c]?.w;
    const after = current.columnData?.[c]?.w;
    if (before !== after && after) ws.getColumn(Number(c) + 1).width = Math.max(1, (after - COLUMN_PADDING_PX) / PX_PER_CHAR);
  }
  for (const r of new Set([...Object.keys(base.rowData ?? {}), ...Object.keys(current.rowData ?? {})])) {
    const before = base.rowData?.[r]?.h;
    const after = current.rowData?.[r]?.h;
    if (before !== after && after) ws.getRow(Number(r) + 1).height = after / PX_PER_POINT;
  }

  if (!same(base.freeze ?? null, current.freeze ?? null)) {
    const f = current.freeze;
    ws.views = f && (f.xSplit || f.ySplit) ? [{ state: "frozen", xSplit: f.xSplit, ySplit: f.ySplit }] : [{ state: "normal" }];
  }
}

function addSheet(wb: ExcelJS.Workbook, sheet: SheetSnapshot, styles: WorkbookSnapshot["styles"]): void {
  const ws = wb.addWorksheet(sheet.name);
  patchSheet(ws, { ...sheet, name: sheet.name, cellData: {}, mergeData: [], columnData: {}, rowData: {} }, sheet, {}, styles);
}

export async function patchXlsx(original: Uint8Array, base: WorkbookSnapshot, current: WorkbookSnapshot): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(original as unknown as ArrayBuffer);

  for (const id of current.sheetOrder) {
    const sheet = current.sheets[id];
    if (!sheet) continue;
    const before = base.sheets[id];
    const ws = before ? wb.getWorksheet(before.name) : undefined;
    if (before && ws) patchSheet(ws, before, sheet, base.styles, current.styles);
    else addSheet(wb, sheet, current.styles);
  }
  for (const id of base.sheetOrder) {
    if (current.sheets[id]) continue;
    const gone = base.sheets[id] && wb.getWorksheet(base.sheets[id]!.name);
    if (gone) wb.removeWorksheet(gone.id);
  }
  if (wb.worksheets.length === 0) wb.addWorksheet("Sheet1");
  return Buffer.from(await wb.xlsx.writeBuffer());
}
