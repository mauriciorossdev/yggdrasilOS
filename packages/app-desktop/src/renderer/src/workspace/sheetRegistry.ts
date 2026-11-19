import { createControllerRegistry } from "./controllerRegistry.js";
import type { CellInput, ReadResult } from "./sheetOps.js";

/** What can be done to an open spreadsheet from outside its editor (an agent's tool call). */
export type SheetController = {
  info: () => { sheets: string[]; activeSheet: string; usedRange: string };
  readRange: (range: string, sheet?: string) => ReadResult;
  /** Writes `values` with its top-left cell at the start of `range` (the range's own end is ignored). With formulas, resolves once they are calculated, so a read right after sees the results. */
  writeRange: (range: string, values: CellInput[][], sheet?: string) => Promise<{ written: string }>;
};

const registry = createControllerRegistry<SheetController>("spreadsheet");

/** The editor for `path` calls this once its workbook is ready; the returned function unregisters it. */
export const registerSheetController = registry.register;
export const getSheetController = registry.get;
/** The editor could not open `path` (missing or unreadable file): whoever is waiting for it fails now, with the real reason. */
export const failSheetOpen = registry.failOpen;
/** Resolves when the editor for `path` is ready (immediately if it already is); rejects if it fails to open or after `timeoutMs`. */
export const whenSheetReady = registry.whenReady;
export const resetSheetRegistryForTest = registry.reset;
