import type { WorkbookSnapshot } from "@yggdrasil/tool-office/browser";

/**
 * A fingerprint of what a person would call "the content" of a workbook: sheet names, cells (values,
 * formulas, styles), the style table, merges and column widths. Auto-fit row heights and view state
 * (scroll, zoom, selection) are left out on purpose, so opening a file — which makes the editor
 * recompute those — doesn't count as an edit and never rewrites the file through the converter.
 */
export function contentSignature(snapshot: WorkbookSnapshot): string {
  const sheets = snapshot.sheetOrder.map((id) => {
    const s = snapshot.sheets[id];
    return s ? [s.name, s.cellData, s.mergeData ?? [], s.columnData ?? {}] : null;
  });
  return JSON.stringify([sheets, snapshot.styles]);
}
