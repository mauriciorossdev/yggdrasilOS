/**
 * Plain-text extraction for chat attachments (fs.readDocumentText in
 * methods.ts) — turns a file into something worth sending as LLM context.
 * Only PDF needs real work; everything else fs.readDocumentText already
 * handles as plain utf8 (same as fs.read).
 *
 * Uses pdfjs-dist's Node "legacy" build directly rather than a wrapper like
 * pdf-parse — pdf-parse's current major pulls in @napi-rs/canvas (a native
 * binary) for rendering, which this doesn't need: getTextContent() reads
 * text straight from the PDF's content streams, no rendering/canvas
 * involved. pdfjs-dist itself has zero native dependencies.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // pdfjs-dist rejects a Node Buffer outright (it insists on a plain
  // Uint8Array, even though Buffer is a subclass) — readFile's return value
  // must be copied into a bare Uint8Array first.
  const data = bytes instanceof Buffer ? new Uint8Array(bytes) : bytes;
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, disableFontFace: true }).promise;

  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  await doc.destroy();

  return pages.join("\n\n").trim();
}
