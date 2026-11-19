/**
 * A deliberately small model of a text document: what a person edits in a word processor day to day.
 * It is the middle ground between a .docx file (docx/read.ts, docx/write.ts) and the editor (the renderer
 * turns it into and out of its own document). Plain JSON, no Node or browser dependencies.
 *
 * Not modelled (a round trip drops them; docx/inspect.ts warns before saving over such a file): headers and
 * footers, comments, footnotes, tracked changes, text boxes, equations, fields (a table of contents),
 * charts, SmartArt, embedded objects, font families/sizes, line spacing and section layout.
 */

export type Align = "left" | "center" | "right" | "justify";

/** A stretch of text with the same formatting. "\n" inside `text` is a line break, "\t" a tab. */
export type Run = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** Monospace (inline code). */
  code?: boolean;
  /** Text colour, "#RRGGBB". */
  color?: string;
  /** Background colour, "#RRGGBB". */
  highlight?: string;
  /** Makes the run a hyperlink. */
  link?: string;
  superscript?: boolean;
  subscript?: boolean;
};

export type ParagraphBlock = { type: "paragraph"; runs: Run[]; align?: Align };
export type HeadingBlock = { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; runs: Run[]; align?: Align };
export type ListItem = { runs: Run[]; children?: ListBlock[] };
export type ListBlock = { type: "list"; ordered: boolean; items: ListItem[] };
export type TableCell = { blocks: Block[]; header?: boolean; colSpan?: number };
export type TableBlock = { type: "table"; rows: TableCell[][] };
/** A picture on its own line. `data` is the raw bytes as base64 (no data: prefix). */
export type ImageBlock = { type: "image"; data: string; mime: string; width?: number; height?: number; alt?: string };
export type CodeBlock = { type: "code"; text: string };
export type PageBreakBlock = { type: "pageBreak" };

export type Block = ParagraphBlock | HeadingBlock | ListBlock | TableBlock | ImageBlock | CodeBlock | PageBreakBlock;

export type DocModel = { blocks: Block[] };

export const EMPTY_DOC: DocModel = { blocks: [{ type: "paragraph", runs: [] }] };

/** The plain text of a run list, for summaries and tests. */
export function textOf(runs: Run[]): string {
  return runs.map((r) => r.text).join("");
}
