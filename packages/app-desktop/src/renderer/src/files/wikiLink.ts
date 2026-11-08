import type { WikiItem } from "../documents/notesIndex.js";
import { relativeFromNote } from "./imageNames.js";

/** How far back from the cursor `[[` may be and still count (a title longer than this isn't a search). */
const MAX_QUERY = 60;

/**
 * Whether the text before the cursor ends in an open `[[query`: where it starts in that text and what has been
 * typed after it. A closing `]`, another `[` or a line break ends it.
 */
export function detectWikiTrigger(textBefore: string): { start: number; query: string } | null {
  const match = new RegExp(`\\[\\[([^\\[\\]\\n]{0,${MAX_QUERY}})$`).exec(textBefore);
  return match ? { start: match.index, query: match[1]! } : null;
}

/** Lowercase and without accents, so "indice" finds "Índice". */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** The picker's list for what was typed: titles that start with it first, then ones that contain it, then paths that do. */
export function filterWikiItems(items: WikiItem[], query: string, limit = 8): WikiItem[] {
  const needle = fold(query.trim());
  if (!needle) return items.slice(0, limit);
  const rank = (item: WikiItem): number => {
    const title = fold(item.title);
    if (title.startsWith(needle)) return 0;
    if (title.split(/[\s\-_/]+/).some((word) => word.startsWith(needle))) return 1;
    if (title.includes(needle)) return 2;
    if (fold(item.path).includes(needle)) return 3;
    return -1;
  };
  return items
    .map((item, i) => ({ item, rank: rank(item), i }))
    .filter((x) => x.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.item);
}

/**
 * The address to write in a note at `fromPath` for the note at `toPath`: relative to the note's folder, with the
 * characters that would end a markdown link destination (space, parentheses) percent-encoded.
 */
export function noteHref(fromPath: string, toPath: string): string {
  return relativeFromNote(fromPath, toPath).replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
}
