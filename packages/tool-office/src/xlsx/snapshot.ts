/**
 * The slice of Univer's workbook snapshot (IWorkbookData) this package reads and writes. Structural on
 * purpose: tool-office doesn't depend on Univer, the renderer hands its snapshot over as plain JSON.
 * Numbers are Univer's own enums: CellValueType STRING=1 NUMBER=2 BOOLEAN=3 FORCE_STRING=4;
 * horizontal align 1/2/3 = left/center/right; vertical align 1/2/3 = top/middle/bottom; wrap 3 = wrap.
 */

export const CELL_STRING = 1;
export const CELL_NUMBER = 2;
export const CELL_BOOLEAN = 3;

export type ColorStyle = { rgb?: string | null };

/** Univer's border sides: `s` is BorderStyleTypes (1 thin … 13 thick), `cl` the colour. */
export type BorderSide = { s: number; cl?: ColorStyle | null } | null;
export type BorderData = { t?: BorderSide; r?: BorderSide; b?: BorderSide; l?: BorderSide };

export type StyleData = {
  ff?: string | null;
  fs?: number;
  it?: 0 | 1;
  bl?: 0 | 1;
  ul?: { s?: 0 | 1 } | null;
  st?: { s?: 0 | 1 } | null;
  bg?: ColorStyle | null;
  cl?: ColorStyle | null;
  ht?: number | null;
  vt?: number | null;
  tb?: number | null;
  n?: { pattern?: string } | null;
  bd?: BorderData | null;
};

export type CellData = {
  v?: string | number | boolean | null;
  t?: number | null;
  f?: string | null;
  /** A style id into the workbook's `styles`, or an inline style. */
  s?: string | StyleData | null;
};

export type MergeRange = { startRow: number; endRow: number; startColumn: number; endColumn: number };

export type SheetSnapshot = {
  id: string;
  name: string;
  rowCount: number;
  columnCount: number;
  cellData: Record<string, Record<string, CellData>>;
  mergeData?: MergeRange[];
  columnData?: Record<string, { w?: number }>;
  rowData?: Record<string, { h?: number }>;
  freeze?: { xSplit: number; ySplit: number; startRow: number; startColumn: number };
  [extra: string]: unknown;
};

export type WorkbookSnapshot = {
  id: string;
  name: string;
  appVersion: string;
  locale: string;
  styles: Record<string, StyleData | null | undefined>;
  sheetOrder: string[];
  sheets: Record<string, SheetSnapshot>;
  [extra: string]: unknown;
};
