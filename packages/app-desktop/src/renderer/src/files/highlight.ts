/** A piece of text and whether it is the part to stress. */
export type HighlightPart = { text: string; match: boolean };

/** Splits `text` around the range [start, end); an empty or out-of-range one leaves it whole. */
export function splitAt(text: string, start: number, end: number): HighlightPart[] {
  const from = Math.max(0, Math.min(start, text.length));
  const to = Math.max(from, Math.min(end, text.length));
  if (to === from) return [{ text, match: false }];
  return [
    { text: text.slice(0, from), match: false },
    { text: text.slice(from, to), match: true },
    { text: text.slice(to), match: false },
  ].filter((part) => part.text !== "");
}

/** Every case-insensitive occurrence of `query` in `text`, so a file name can show where it matched. */
export function highlightQuery(text: string, query: string): HighlightPart[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [{ text, match: false }];
  const lower = text.toLowerCase();
  const parts: HighlightPart[] = [];
  let from = 0;
  for (let at = lower.indexOf(needle, from); at >= 0; at = lower.indexOf(needle, from)) {
    if (at > from) parts.push({ text: text.slice(from, at), match: false });
    parts.push({ text: text.slice(at, at + needle.length), match: true });
    from = at + needle.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), match: false });
  return parts.length > 0 ? parts : [{ text, match: false }];
}
