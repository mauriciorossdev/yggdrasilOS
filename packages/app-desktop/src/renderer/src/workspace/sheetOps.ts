/**
 * Plain-data helpers for what an agent asks of an open spreadsheet. Kept free of Univer so the rules
 * (limits, what counts as a formula, how a result is shaped) are testable without a browser.
 */

export type CellInput = string | number | boolean | null;

/** Univer's ICellData for what we write: a typed value, or a formula. CellValueType NUMBER=2, STRING=1, BOOLEAN=3. */
export type CellWrite = { v: string | number | boolean; t: number } | { f: string } | null;

/** Reads/writes bigger than this are refused so one tool call can't flood the model's context or freeze the editor. */
export const MAX_CELLS = 5000;

export function toCellWrite(value: CellInput): CellWrite {
  if (value === null || value === "") return null;
  if (typeof value === "string" && value.startsWith("=")) return { f: value };
  if (typeof value === "number") return { v: value, t: 2 };
  if (typeof value === "boolean") return { v: value, t: 3 };
  return { v: value, t: 1 };
}

export function toCellWrites(values: CellInput[][]): CellWrite[][] {
  return values.map((row) => row.map(toCellWrite));
}

/** Rows × columns of a rectangular 2D array, or an error naming the problem (ragged rows, empty, too big). */
export function shapeOf(values: CellInput[][]): { rows: number; columns: number } {
  if (!Array.isArray(values) || values.length === 0) throw new Error("values must be a non-empty 2D array");
  const columns = values[0]?.length ?? 0;
  if (columns === 0) throw new Error("values must have at least one column");
  if (values.some((row) => !Array.isArray(row) || row.length !== columns)) throw new Error("every row of values must have the same number of columns");
  if (values.length * columns > MAX_CELLS) throw new Error(`too many cells (${values.length * columns}); write at most ${MAX_CELLS} per call`);
  return { rows: values.length, columns };
}

export function assertReadable(rows: number, columns: number): void {
  if (rows * columns > MAX_CELLS) throw new Error(`range too large (${rows * columns} cells); read at most ${MAX_CELLS} per call`);
}

export type ReadResult = {
  range: string;
  /** Raw values (formula cells hold their calculated result); empty cells are null. */
  values: CellInput[][];
  /** The formula text where a cell has one, else null. */
  formulas: (string | null)[][];
};

/** Merges Univer's value and formula grids into one result: formulas come back as "" for non-formula cells. */
export function readResult(range: string, values: unknown[][], formulas: string[][]): ReadResult {
  return {
    range,
    values: values.map((row) => row.map((v) => (v === undefined || v === "" ? null : (v as CellInput)))),
    formulas: formulas.map((row) => row.map((f) => (f ? f : null))),
  };
}
