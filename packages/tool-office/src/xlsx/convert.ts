import ExcelJS from "exceljs";
import {
  CELL_BOOLEAN,
  CELL_NUMBER,
  CELL_STRING,
  type CellData,
  type MergeRange,
  type SheetSnapshot,
  type StyleData,
  type WorkbookSnapshot,
} from "./snapshot.js";

/**
 * .xlsx ⇄ Univer snapshot. Covers what a person edits in a sheet: values, formulas (with their cached
 * results), number formats, bold/italic/underline/strike, font name/size/colour, fill, alignment and wrap,
 * merged cells, column widths, row heights and frozen panes. It does NOT carry borders, conditional
 * formatting, charts, images, pivot tables or data validation yet — a round trip drops those.
 */

export const APP_VERSION = "1.5.2";
const MIN_ROWS = 200;
const MIN_COLUMNS = 26;
/** Spare room around the data so the grid doesn't end exactly at the last cell. */
const ROW_PADDING = 100;
const COLUMN_PADDING = 6;
/** Excel column width is in characters; Univer's is in pixels (≈ 7px per character + 5px padding). */
export const PX_PER_CHAR = 7;
export const COLUMN_PADDING_PX = 5;
export const PX_PER_POINT = 4 / 3;

const H_ALIGN: Record<string, number> = { left: 1, center: 2, right: 3, justify: 4, distributed: 5 };
const V_ALIGN: Record<string, number> = { top: 1, middle: 2, bottom: 3 };
const H_ALIGN_BACK: Record<number, ExcelJS.Alignment["horizontal"]> = { 1: "left", 2: "center", 3: "right", 4: "justify", 5: "distributed" };
const V_ALIGN_BACK: Record<number, ExcelJS.Alignment["vertical"]> = { 1: "top", 2: "middle", 3: "bottom" };

/** ExcelJS border style names ⇄ Univer's BorderStyleTypes numbers. */
const BORDER_TO_UNIVER: Record<string, number> = {
  thin: 1, hair: 2, dotted: 3, dashed: 4, dashDot: 5, dashDotDot: 6, double: 7,
  medium: 8, mediumDashed: 9, mediumDashDot: 10, mediumDashDotDot: 11, slantDashDot: 12, thick: 13,
};
const BORDER_FROM_UNIVER: Record<number, ExcelJS.BorderStyle> = Object.fromEntries(
  Object.entries(BORDER_TO_UNIVER).map(([name, n]) => [n, name as ExcelJS.BorderStyle]),
);
const BORDER_SIDES = [["top", "t"], ["right", "r"], ["bottom", "b"], ["left", "l"]] as const;

/** ExcelJS "FF3366CC" (ARGB) → "#3366CC". */
export function argbToHex(argb: string | undefined): string | undefined {
  if (!argb) return undefined;
  const rgb = argb.length === 8 ? argb.slice(2) : argb;
  return /^[0-9a-fA-F]{6}$/.test(rgb) ? `#${rgb.toUpperCase()}` : undefined;
}

export function hexToArgb(hex: string | null | undefined): string | undefined {
  if (!hex) return undefined;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  return m ? `FF${m[1]!.toUpperCase()}` : undefined;
}

/** Excel stores dates as days since 1899-12-30. */
function dateToSerial(d: Date): number {
  return d.getTime() / 86_400_000 + 25569;
}

function styleFromCell(cell: ExcelJS.Cell): StyleData | undefined {
  const style: StyleData = {};
  const f = cell.font;
  if (f) {
    if (f.name) style.ff = f.name;
    if (f.size) style.fs = f.size;
    if (f.bold) style.bl = 1;
    if (f.italic) style.it = 1;
    if (f.underline) style.ul = { s: 1 };
    if (f.strike) style.st = { s: 1 };
    const color = argbToHex(f.color?.argb);
    if (color) style.cl = { rgb: color };
  }
  const fill = cell.fill;
  if (fill && fill.type === "pattern" && fill.pattern === "solid") {
    const bg = argbToHex(fill.fgColor?.argb);
    if (bg) style.bg = { rgb: bg };
  }
  const a = cell.alignment;
  if (a) {
    if (a.horizontal && H_ALIGN[a.horizontal]) style.ht = H_ALIGN[a.horizontal];
    if (a.vertical && V_ALIGN[a.vertical]) style.vt = V_ALIGN[a.vertical];
    if (a.wrapText) style.tb = 3;
  }
  if (cell.numFmt && cell.numFmt !== "General") style.n = { pattern: cell.numFmt };
  const border = cell.border;
  if (border) {
    const bd: NonNullable<StyleData["bd"]> = {};
    for (const [excelSide, univerSide] of BORDER_SIDES) {
      const side = border[excelSide];
      const kind = side?.style ? BORDER_TO_UNIVER[side.style] : undefined;
      if (side && kind) bd[univerSide] = { s: kind, cl: { rgb: argbToHex(side.color?.argb) ?? "#000000" } };
    }
    if (Object.keys(bd).length > 0) style.bd = bd;
  }
  return Object.keys(style).length > 0 ? style : undefined;
}

function textOf(value: ExcelJS.CellValue): string {
  if (value && typeof value === "object") {
    if ("richText" in value) return value.richText.map((r) => r.text).join("");
    if ("text" in value) return String((value as { text: unknown }).text ?? "");
    if ("error" in value) return String((value as { error: unknown }).error);
  }
  return String(value ?? "");
}

function cellFromExcel(cell: ExcelJS.Cell, styleIdFor: (s: StyleData) => string): CellData | undefined {
  const out: CellData = {};
  const type = cell.type;
  if (type === ExcelJS.ValueType.Null || type === ExcelJS.ValueType.Merge) {
    // An empty cell still matters when it carries a style (a filled header, a bordered total).
  } else if (type === ExcelJS.ValueType.Formula) {
    const formula = cell.formula;
    if (formula) out.f = `=${formula}`;
    const result = cell.result;
    if (typeof result === "number") (out.v = result), (out.t = CELL_NUMBER);
    else if (typeof result === "boolean") (out.v = result), (out.t = CELL_BOOLEAN);
    else if (result instanceof Date) (out.v = dateToSerial(result)), (out.t = CELL_NUMBER);
    else if (result !== undefined && result !== null) (out.v = typeof result === "object" ? textOf(result as ExcelJS.CellValue) : String(result)), (out.t = CELL_STRING);
  } else if (type === ExcelJS.ValueType.Number) {
    out.v = cell.value as number;
    out.t = CELL_NUMBER;
  } else if (type === ExcelJS.ValueType.Boolean) {
    out.v = cell.value as boolean;
    out.t = CELL_BOOLEAN;
  } else if (type === ExcelJS.ValueType.Date) {
    out.v = dateToSerial(cell.value as Date);
    out.t = CELL_NUMBER;
  } else {
    out.v = textOf(cell.value);
    out.t = CELL_STRING;
  }
  const style = styleFromCell(cell);
  if (style) out.s = styleIdFor(style);
  return out.v !== undefined || out.f || out.s ? out : undefined;
}

function parseMerge(ref: string): MergeRange | undefined {
  const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return undefined;
  const col = (letters: string) => letters.split("").reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
  return { startColumn: col(m[1]!), startRow: Number(m[2]) - 1, endColumn: col(m[3]!), endRow: Number(m[4]) - 1 };
}

export async function xlsxToSnapshot(data: Uint8Array | ArrayBuffer, name = "Workbook"): Promise<WorkbookSnapshot> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as ArrayBuffer);

  const styles: WorkbookSnapshot["styles"] = {};
  const styleIds = new Map<string, string>();
  const styleIdFor = (s: StyleData): string => {
    const key = JSON.stringify(s);
    let id = styleIds.get(key);
    if (!id) {
      id = `s${styleIds.size + 1}`;
      styleIds.set(key, id);
      styles[id] = s;
    }
    return id;
  };

  const sheets: WorkbookSnapshot["sheets"] = {};
  const sheetOrder: string[] = [];
  wb.eachSheet((ws, index) => {
    const id = `sheet-${index}`;
    const cellData: SheetSnapshot["cellData"] = {};
    let maxRow = 0;
    let maxCol = 0;
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const data = cellFromExcel(cell, styleIdFor);
        if (!data) return;
        (cellData[rowNumber - 1] ??= {})[colNumber - 1] = data;
        maxRow = Math.max(maxRow, rowNumber);
        maxCol = Math.max(maxCol, colNumber);
      });
    });

    const columnData: NonNullable<SheetSnapshot["columnData"]> = {};
    for (let c = 1; c <= Math.max(ws.columnCount, maxCol); c++) {
      const width = ws.getColumn(c).width;
      if (width) columnData[c - 1] = { w: Math.round(width * PX_PER_CHAR + COLUMN_PADDING_PX) };
    }
    const rowData: NonNullable<SheetSnapshot["rowData"]> = {};
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (row.height) rowData[rowNumber - 1] = { h: Math.round(row.height * PX_PER_POINT) };
    });

    const merges = Object.keys((ws.model as { merges?: string[] }).merges ?? {}).length
      ? Object.values((ws.model as { merges: string[] }).merges)
      : [];
    const mergeData = merges.map(parseMerge).filter((m): m is MergeRange => !!m);

    const sheet: SheetSnapshot = {
      id,
      name: ws.name,
      rowCount: Math.max(MIN_ROWS, maxRow + ROW_PADDING),
      columnCount: Math.max(MIN_COLUMNS, maxCol + COLUMN_PADDING),
      cellData,
      mergeData,
      columnData,
      rowData,
    };
    const view = ws.views?.[0];
    if (view && view.state === "frozen" && (view.xSplit || view.ySplit)) {
      sheet.freeze = { xSplit: view.xSplit ?? 0, ySplit: view.ySplit ?? 0, startColumn: view.xSplit ?? 0, startRow: view.ySplit ?? 0 };
    }
    sheets[id] = sheet;
    sheetOrder.push(id);
  });

  return { id: `workbook-${Date.now().toString(36)}`, name, appVersion: APP_VERSION, locale: "enUS", styles, sheetOrder, sheets };
}

export function styleOf(cell: CellData, styles: WorkbookSnapshot["styles"]): StyleData | undefined {
  if (!cell.s) return undefined;
  return typeof cell.s === "string" ? (styles[cell.s] ?? undefined) : cell.s;
}

export function applyStyle(target: ExcelJS.Cell, style: StyleData): void {
  const font: Partial<ExcelJS.Font> = {};
  if (style.ff) font.name = style.ff;
  if (style.fs) font.size = style.fs;
  if (style.bl) font.bold = true;
  if (style.it) font.italic = true;
  if (style.ul?.s) font.underline = true;
  if (style.st?.s) font.strike = true;
  const color = hexToArgb(style.cl?.rgb);
  if (color) font.color = { argb: color };
  if (Object.keys(font).length > 0) target.font = font;

  const bg = hexToArgb(style.bg?.rgb);
  if (bg) target.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };

  const alignment: Partial<ExcelJS.Alignment> = {};
  if (style.ht && H_ALIGN_BACK[style.ht]) alignment.horizontal = H_ALIGN_BACK[style.ht];
  if (style.vt && V_ALIGN_BACK[style.vt]) alignment.vertical = V_ALIGN_BACK[style.vt];
  if (style.tb === 3) alignment.wrapText = true;
  if (Object.keys(alignment).length > 0) target.alignment = alignment;

  if (style.n?.pattern) target.numFmt = style.n.pattern;

  if (style.bd) {
    const border: Partial<ExcelJS.Borders> = {};
    for (const [excelSide, univerSide] of BORDER_SIDES) {
      const side = style.bd[univerSide];
      const kind = side ? BORDER_FROM_UNIVER[side.s] : undefined;
      if (side && kind) border[excelSide] = { style: kind, color: { argb: hexToArgb(side.cl?.rgb) ?? "FF000000" } };
    }
    if (Object.keys(border).length > 0) target.border = border;
  }
}

export async function snapshotToXlsx(snapshot: WorkbookSnapshot): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const order = snapshot.sheetOrder.length > 0 ? snapshot.sheetOrder : Object.keys(snapshot.sheets);
  for (const id of order) {
    const sheet = snapshot.sheets[id];
    if (!sheet) continue;
    const ws = wb.addWorksheet(sheet.name || id);

    for (const [r, columns] of Object.entries(sheet.cellData ?? {})) {
      for (const [c, cell] of Object.entries(columns)) {
        const target = ws.getCell(Number(r) + 1, Number(c) + 1);
        const hasFormula = typeof cell.f === "string" && cell.f.length > 0;
        if (hasFormula) {
          target.value = { formula: cell.f!.replace(/^=/, ""), result: (cell.v ?? undefined) as ExcelJS.CellFormulaValue["result"] };
        } else if (cell.v !== undefined && cell.v !== null && cell.v !== "") {
          target.value = cell.v;
        }
        const style = styleOf(cell, snapshot.styles);
        if (style) applyStyle(target, style);
      }
    }

    for (const m of sheet.mergeData ?? []) ws.mergeCells(m.startRow + 1, m.startColumn + 1, m.endRow + 1, m.endColumn + 1);
    for (const [c, col] of Object.entries(sheet.columnData ?? {})) {
      if (col.w) ws.getColumn(Number(c) + 1).width = Math.max(1, (col.w - COLUMN_PADDING_PX) / PX_PER_CHAR);
    }
    for (const [r, row] of Object.entries(sheet.rowData ?? {})) {
      if (row.h) ws.getRow(Number(r) + 1).height = row.h / PX_PER_POINT;
    }
    if (sheet.freeze && (sheet.freeze.xSplit || sheet.freeze.ySplit)) {
      ws.views = [{ state: "frozen", xSplit: sheet.freeze.xSplit, ySplit: sheet.freeze.ySplit }];
    }
  }
  if (wb.worksheets.length === 0) wb.addWorksheet("Sheet1");
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** A blank snapshot with one sheet, optionally pre-filled from a 2D array (values; strings starting with "=" become formulas). */
export function newSnapshot(name: string, rows: Array<Array<string | number | boolean | null>> = []): WorkbookSnapshot {
  const cellData: SheetSnapshot["cellData"] = {};
  let maxCol = 0;
  rows.forEach((row, r) => {
    row.forEach((value, c) => {
      if (value === null || value === "") return;
      const cell: CellData = typeof value === "string" && value.startsWith("=")
        ? { f: value }
        : { v: value, t: typeof value === "number" ? CELL_NUMBER : typeof value === "boolean" ? CELL_BOOLEAN : CELL_STRING };
      (cellData[r] ??= {})[c] = cell;
      maxCol = Math.max(maxCol, c + 1);
    });
  });
  const id = "sheet-1";
  return {
    id: `workbook-${Date.now().toString(36)}`,
    name,
    appVersion: APP_VERSION,
    locale: "enUS",
    styles: {},
    sheetOrder: [id],
    sheets: { [id]: { id, name: "Sheet1", rowCount: Math.max(MIN_ROWS, rows.length + ROW_PADDING), columnCount: Math.max(MIN_COLUMNS, maxCol + COLUMN_PADDING), cellData } },
  };
}
