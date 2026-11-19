import JSZip from "jszip";

/**
 * What a .docx has that the document model can't keep (see model.ts): saving over the file would silently
 * drop these, so the editor won't auto-save such a file. Short human-readable names, in the order found.
 */
export async function inspectDocxLossy(data: Uint8Array): Promise<string[]> {
  const found = new Set<string>();
  const zip = await JSZip.loadAsync(data);
  const parts = Object.keys(zip.files);
  const read = async (name: string) => (await zip.file(name)?.async("string")) ?? "";

  if (parts.includes("word/comments.xml")) found.add("comments");
  if (parts.some((p) => p.startsWith("word/charts/"))) found.add("charts");
  if (parts.some((p) => p.startsWith("word/diagrams/"))) found.add("SmartArt");
  if (parts.some((p) => p.startsWith("word/embeddings/"))) found.add("embedded objects");

  // Headers and footers only count when they say something (Word writes empty ones all the time).
  for (const part of parts.filter((p) => /^word\/(header|footer)\d*\.xml$/.test(p))) {
    const xml = await read(part);
    if (/<w:t[ >][^<]*[^<\s][^<]*<\/w:t>|<w:instrText|<w:fldSimple/.test(xml)) {
      found.add("headers or footers");
      break;
    }
  }
  // Footnotes always hold the two separator notes (ids -1/0 or 0/1); more than that is real content.
  for (const [part, name] of [["word/footnotes.xml", "footnotes"], ["word/endnotes.xml", "endnotes"]] as const) {
    if (((await read(part)).match(/<w:(footnote|endnote)[ >]/g) ?? []).length > 2) found.add(name);
  }

  const body = await read("word/document.xml");
  if (/<w:(ins|del)[ >]/.test(body)) found.add("tracked changes");
  if (body.includes("<w:txbxContent")) found.add("text boxes");
  if (body.includes("<m:oMath")) found.add("equations");
  if (/<w:instrText|<w:fldSimple/.test(body)) found.add("fields (like a table of contents)");
  if (/<w:pict[ >]|<v:shape[ >]/.test(body)) found.add("shapes");
  if (body.includes("<w:object")) found.add("embedded objects");
  if (/<w:cols [^>]*w:num="([2-9])"/.test(body)) found.add("columns");
  if (/<w:vMerge[ />]/.test(body)) found.add("merged table rows");
  return [...found];
}
