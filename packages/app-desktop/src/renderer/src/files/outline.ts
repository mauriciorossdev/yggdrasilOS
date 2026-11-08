import type { Node as PMNode } from "@tiptap/pm/model";

/** One heading of a document, in the order it appears. */
export type OutlineItem = {
  level: number;
  text: string;
  /** 1-based line in the markdown source (source view). */
  line?: number;
  /** Position in the rich editor's document (rich view). */
  pos?: number;
};

/** A heading's text without its inline markdown: emphasis marks, code ticks, link and image syntax. */
export function plainHeadingText(raw: string): string {
  return raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`]+/g, "")
    .replace(/\s+#+\s*$/, "")
    .trim();
}

/**
 * The headings of a markdown document, from its source: `#`..`######` lines, skipping the front
 * matter and anything inside a fenced code block (where a `#` is a comment, not a title).
 */
export function extractOutline(markdown: string): OutlineItem[] {
  const lines = markdown.split(/\r?\n/);
  const items: OutlineItem[] = [];
  let i = 0;
  if (lines[0]?.trim() === "---") {
    const close = lines.findIndex((l, n) => n > 0 && l.trim() === "---");
    if (close > 0) i = close + 1;
  }
  let fence: string | null = null;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1]![0]!;
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const heading = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
    if (!heading) continue;
    const text = plainHeadingText(heading[2]!);
    if (text) items.push({ level: heading[1]!.length, text, line: i + 1 });
  }
  return items;
}

/** The headings of the rich editor's document, with the position of each; same order as the headings on screen. */
export function outlineFromDoc(doc: PMNode): OutlineItem[] {
  const items: OutlineItem[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      // Empty headings stay in the list (as "Sin título") so the list lines up with the headings on screen.
      items.push({ level: Number(node.attrs.level) || 1, text: node.textContent.trim() || "Sin título", pos });
    }
    return true;
  });
  return items;
}

/** Index of the last heading at or before `line` (the section the cursor is in); -1 before the first one. */
export function activeOutlineIndex(items: OutlineItem[], line: number): number {
  let active = -1;
  for (let i = 0; i < items.length; i++) {
    if ((items[i]!.line ?? Infinity) <= line) active = i;
    else break;
  }
  return active;
}

/**
 * Indents for display: the shallowest level in the document is the margin, so a note that
 * starts at `##` doesn't hang indented under nothing.
 */
export function outlineDepths(items: OutlineItem[]): number[] {
  const min = items.reduce((m, it) => Math.min(m, it.level), 6);
  return items.map((it) => Math.min(it.level - min, 4));
}
