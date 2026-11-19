import JSZip from "jszip";

/**
 * What a workbook has that even patching the original can't keep (see patch.ts): saving would silently
 * drop these, so the editor refuses to auto-save such a file. Things ExcelJS carries through untouched
 * (borders, conditional formatting, data validation, hyperlinks, images, tables) are NOT listed.
 * Returned as short names so the editor can warn before touching the file.
 */
export async function inspectLossyFeatures(data: Uint8Array): Promise<string[]> {
  const found = new Set<string>();
  const zip = await JSZip.loadAsync(data);
  const parts = Object.keys(zip.files);

  if (parts.some((p) => p.startsWith("xl/charts/"))) found.add("charts");
  if (parts.some((p) => p.startsWith("xl/pivotTables/"))) found.add("pivot tables");
  if (parts.some((p) => p.startsWith("xl/slicers/"))) found.add("slicers");
  // ExcelJS keeps a note on a cell that has a value, but drops one on an EMPTY cell even in a plain read→write,
  // and which comment sits on which cell isn't cheap to tell apart: any comments make the file read-only here.
  if (parts.some((p) => /^xl\/(comments\d*\.xml|threadedComments\/)/.test(p))) found.add("comments");

  // Shapes and text boxes live in the drawing parts next to pictures (which are kept).
  for (const part of parts.filter((p) => /^xl\/drawings\/drawing\d+\.xml$/.test(p))) {
    const xml = await zip.file(part)!.async("string");
    if (/<xdr:(sp|grpSp|cxnSp)[\s>/]/.test(xml)) found.add("shapes");
  }
  // Sparklines are an extension inside the sheet XML.
  for (const part of parts.filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))) {
    if ((await zip.file(part)!.async("string")).includes("sparklineGroups")) {
      found.add("sparklines");
      break;
    }
  }
  return [...found];
}
