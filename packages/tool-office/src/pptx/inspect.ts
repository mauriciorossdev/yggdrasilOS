import JSZip from "jszip";
import { pptxToDeck } from "./read.js";

export const FOREIGN_DECK = "design and layout from another app";

/**
 * What a .pptx has that the deck model can't keep (see model.ts): saving over the file would silently drop
 * it, so the editor won't auto-save such a file. A deck that was not written by this app (or was saved by
 * another one since) always counts: its master, theme and positions are not modelled.
 */
export async function inspectPptxLossy(data: Uint8Array): Promise<string[]> {
  const found = new Set<string>();
  const zip = await JSZip.loadAsync(data);
  const parts = Object.values(zip.files).filter((f) => !f.dir).map((f) => f.name);

  if (!(await pptxToDeck(data)).ours) found.add(FOREIGN_DECK);
  if (parts.some((p) => p.startsWith("ppt/charts/"))) found.add("charts");
  if (parts.some((p) => p.startsWith("ppt/diagrams/"))) found.add("SmartArt");
  if (parts.some((p) => /^ppt\/(comments|commentAuthors)/.test(p))) found.add("comments");
  if (parts.some((p) => /^ppt\/media\/.*\.(mp4|mov|avi|wmv|mp3|wav|m4a)$/i.test(p))) found.add("audio or video");
  for (const part of parts.filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))) {
    const xml = await zip.file(part)!.async("string");
    if (xml.includes("<p:timing")) found.add("animations");
    if (xml.includes("<p:transition")) found.add("transitions");
  }
  return [...found];
}
