import type { DocBlockInfo, DocWriteMode } from "./docRegistry.js";

/** Rules for what an agent may ask of an open document, free of the editor so they can be tested. */

export const MAX_MARKDOWN_CHARS = 200_000;
const SNIPPET_CHARS = 160;

export function snippet(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > SNIPPET_CHARS ? `${oneLine.slice(0, SNIPPET_CHARS - 1)}…` : oneLine;
}

/** Block infos from the document's top-level nodes. */
export function describeBlocks(nodes: Array<{ type: string; text: string }>): DocBlockInfo[] {
  return nodes.map((n, index) => ({ index, type: n.type, text: snippet(n.text) }));
}

/** Embedded pictures are base64 blobs: show the model a placeholder instead of megabytes. */
export function markdownForModel(markdown: string): string {
  return markdown.replace(/\]\(data:[^)]*\)/g, "](embedded-image)");
}

export type WritePlan =
  | { kind: "set-all" }
  | { kind: "insert"; at: "start" | "end" }
  | { kind: "insert-after"; index: number }
  | { kind: "replace-block"; index: number }
  | { kind: "delete-block"; index: number };

/** Validates a write request against the document (`blockCount` top-level blocks) and says what to do. */
export function planWrite(op: { mode: DocWriteMode; markdown?: string; index?: number }, blockCount: number): WritePlan {
  const needsMarkdown = op.mode !== "delete_block";
  if (needsMarkdown && typeof op.markdown !== "string") throw new Error(`markdown is required for mode "${op.mode}"`);
  if ((op.markdown?.length ?? 0) > MAX_MARKDOWN_CHARS) throw new Error(`markdown is too long (max ${MAX_MARKDOWN_CHARS} characters per call)`);

  const withIndex = (): number => {
    const index = op.index;
    if (typeof index !== "number" || !Number.isInteger(index)) throw new Error(`index is required for mode "${op.mode}"`);
    if (index < 0 || index >= blockCount) throw new Error(`index ${index} is out of range: the document has ${blockCount} block(s), numbered from 0`);
    return index;
  };

  switch (op.mode) {
    case "replace":
      return { kind: "set-all" };
    case "append":
      return { kind: "insert", at: "end" };
    case "prepend":
      return { kind: "insert", at: "start" };
    case "insert_after":
      return { kind: "insert-after", index: withIndex() };
    case "replace_block":
      return { kind: "replace-block", index: withIndex() };
    case "delete_block":
      return { kind: "delete-block", index: withIndex() };
    default:
      throw new Error(`unknown mode "${String(op.mode)}"`);
  }
}

export function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/** Non-overlapping occurrences of `find` in `text`, as [start, end) pairs, first to last. */
export function findMatches(text: string, find: string, all: boolean): Array<[number, number]> {
  if (!find) throw new Error("find must not be empty");
  const out: Array<[number, number]> = [];
  for (let at = text.indexOf(find); at !== -1; at = text.indexOf(find, at + find.length)) {
    out.push([at, at + find.length]);
    if (!all) break;
  }
  return out;
}
