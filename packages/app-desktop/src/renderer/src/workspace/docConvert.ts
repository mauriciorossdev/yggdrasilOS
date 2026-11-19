import type { Align, Block, DocModel, ImageBlock, ListBlock, Run, TableCell } from "@yggdrasil/tool-office/browser";

/**
 * DocModel ⇄ the editor's document (Tiptap/ProseMirror JSON). Pure data in, pure data out, so the rules
 * live here and are testable without a browser. The model is what is saved to the .docx; the JSON is what
 * the editor edits.
 */

export type PmNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PmNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
};

// ---- model → editor --------------------------------------------------------------------------

function runToNodes(run: Run): PmNode[] {
  const marks: NonNullable<PmNode["marks"]> = [];
  if (run.bold) marks.push({ type: "bold" });
  if (run.italic) marks.push({ type: "italic" });
  if (run.underline) marks.push({ type: "underline" });
  if (run.strike) marks.push({ type: "strike" });
  if (run.code) marks.push({ type: "code" });
  if (run.superscript) marks.push({ type: "superscript" });
  if (run.subscript) marks.push({ type: "subscript" });
  if (run.color) marks.push({ type: "textStyle", attrs: { color: run.color } });
  if (run.highlight) marks.push({ type: "highlight", attrs: { color: run.highlight } });
  if (run.link) marks.push({ type: "link", attrs: { href: run.link } });
  // A "\n" is a hard break between pieces of text; "\t" stays a character.
  return run.text.split("\n").flatMap((line, i): PmNode[] => {
    const nodes: PmNode[] = i > 0 ? [{ type: "hardBreak" }] : [];
    if (line) nodes.push({ type: "text", text: line, ...(marks.length > 0 ? { marks } : {}) });
    return nodes;
  });
}

const inline = (runs: Run[]): PmNode[] => runs.flatMap(runToNodes);

function listToNode(list: ListBlock): PmNode {
  return {
    type: list.ordered ? "orderedList" : "bulletList",
    content: list.items.map((item) => ({
      type: "listItem",
      content: [{ type: "paragraph", content: inline(item.runs) }, ...(item.children ?? []).map(listToNode)],
    })),
  };
}

function blockToNode(block: Block): PmNode {
  switch (block.type) {
    case "paragraph":
      return { type: "paragraph", ...(block.align ? { attrs: { textAlign: block.align } } : {}), content: inline(block.runs) };
    case "heading":
      return { type: "heading", attrs: { level: block.level, ...(block.align ? { textAlign: block.align } : {}) }, content: inline(block.runs) };
    case "list":
      return listToNode(block);
    case "table":
      return {
        type: "table",
        content: block.rows.map((row) => ({
          type: "tableRow",
          content: row.map((cell) => ({
            type: cell.header ? "tableHeader" : "tableCell",
            attrs: { colspan: cell.colSpan ?? 1, rowspan: 1 },
            content: cell.blocks.length > 0 ? cell.blocks.map(blockToNode) : [{ type: "paragraph" }],
          })),
        })),
      };
    case "image":
      return { type: "image", attrs: { src: `data:${block.mime};base64,${block.data}`, alt: block.alt ?? null, width: block.width ?? null, height: block.height ?? null } };
    case "code":
      return { type: "codeBlock", content: block.text ? [{ type: "text", text: block.text }] : [] };
    case "pageBreak":
      return { type: "pageBreak" };
  }
}

export function modelToDoc(model: DocModel): PmNode {
  const content = model.blocks.map(blockToNode);
  return { type: "doc", content: content.length > 0 ? content : [{ type: "paragraph" }] };
}

// ---- editor → model --------------------------------------------------------------------------

function nodesToRuns(nodes: PmNode[] | undefined): Run[] {
  const runs: Run[] = [];
  for (const node of nodes ?? []) {
    if (node.type === "hardBreak") {
      const prev = runs[runs.length - 1];
      if (prev) prev.text += "\n";
      else runs.push({ text: "\n" });
      continue;
    }
    if (node.type !== "text" || !node.text) continue;
    const run: Run = { text: node.text };
    for (const mark of node.marks ?? []) {
      if (mark.type === "bold") run.bold = true;
      else if (mark.type === "italic") run.italic = true;
      else if (mark.type === "underline") run.underline = true;
      else if (mark.type === "strike") run.strike = true;
      else if (mark.type === "code") run.code = true;
      else if (mark.type === "superscript") run.superscript = true;
      else if (mark.type === "subscript") run.subscript = true;
      else if (mark.type === "textStyle" && typeof mark.attrs?.color === "string") run.color = mark.attrs.color.toUpperCase();
      else if (mark.type === "highlight" && typeof mark.attrs?.color === "string") run.highlight = mark.attrs.color.toUpperCase();
      else if (mark.type === "link" && typeof mark.attrs?.href === "string") run.link = mark.attrs.href;
    }
    // Adjacent pieces with the same formatting are one run.
    const prev = runs[runs.length - 1];
    const { text, ...marks } = run;
    const { text: prevText, ...prevMarks } = prev ?? { text: "" };
    if (prev && JSON.stringify(marks) === JSON.stringify(prevMarks) && !prev.text.endsWith("\n")) prev.text = prevText + text;
    else if (prev && prev.text.endsWith("\n") && JSON.stringify(marks) === JSON.stringify(prevMarks)) prev.text = prevText + text;
    else runs.push(run);
  }
  return runs;
}

const ALIGNS = new Set<string>(["left", "center", "right", "justify"]);
const alignOf = (node: PmNode): Align | undefined => (typeof node.attrs?.textAlign === "string" && ALIGNS.has(node.attrs.textAlign) && node.attrs.textAlign !== "left" ? (node.attrs.textAlign as Align) : undefined);

function nodeToList(node: PmNode): ListBlock {
  return {
    type: "list",
    ordered: node.type === "orderedList",
    items: (node.content ?? []).map((li) => {
      const paragraphs = (li.content ?? []).filter((c) => c.type === "paragraph");
      const nested = (li.content ?? []).filter((c) => c.type === "bulletList" || c.type === "orderedList");
      const runs = paragraphs.flatMap((p, i) => (i === 0 ? nodesToRuns(p.content) : [{ text: "\n" }, ...nodesToRuns(p.content)]));
      return { runs: mergeAdjacent(runs), ...(nested.length > 0 ? { children: nested.map(nodeToList) } : {}) };
    }),
  };
}

function mergeAdjacent(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const run of runs) {
    const prev = out[out.length - 1];
    const { text, ...marks } = run;
    const { text: prevText, ...prevMarks } = prev ?? { text: "" };
    if (prev && JSON.stringify(marks) === JSON.stringify(prevMarks)) prev.text = prevText + text;
    else out.push({ ...run });
  }
  return out;
}

function parseDataUri(src: string): { mime: string; data: string } | null {
  const m = /^data:([^;,]+);base64,(.+)$/.exec(src);
  return m ? { mime: m[1]!, data: m[2]! } : null;
}

function nodeToBlocks(node: PmNode): Block[] {
  switch (node.type) {
    case "paragraph":
      return [{ type: "paragraph", runs: nodesToRuns(node.content), ...(alignOf(node) ? { align: alignOf(node)! } : {}) }];
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 1))) as 1 | 2 | 3 | 4 | 5 | 6;
      return [{ type: "heading", level, runs: nodesToRuns(node.content), ...(alignOf(node) ? { align: alignOf(node)! } : {}) }];
    }
    case "bulletList":
    case "orderedList":
      return [nodeToList(node)];
    case "table":
      return [
        {
          type: "table",
          rows: (node.content ?? []).map((row) =>
            (row.content ?? []).map((cell): TableCell => {
              const span = Number(cell.attrs?.colspan ?? 1);
              return {
                blocks: (cell.content ?? []).flatMap(nodeToBlocks),
                ...(cell.type === "tableHeader" ? { header: true } : {}),
                ...(span > 1 ? { colSpan: span } : {}),
              };
            }),
          ),
        },
      ];
    case "image": {
      const uri = typeof node.attrs?.src === "string" ? parseDataUri(node.attrs.src) : null;
      if (!uri) return []; // a picture that isn't embedded can't go into the .docx
      const block: ImageBlock = { type: "image", ...uri };
      if (typeof node.attrs?.width === "number") block.width = node.attrs.width;
      if (typeof node.attrs?.height === "number") block.height = node.attrs.height;
      if (typeof node.attrs?.alt === "string" && node.attrs.alt) block.alt = node.attrs.alt;
      return [block];
    }
    case "codeBlock":
      return [{ type: "code", text: (node.content ?? []).map((c) => c.text ?? "").join("") }];
    case "pageBreak":
      return [{ type: "pageBreak" }];
    case "horizontalRule":
      return [{ type: "paragraph", runs: [{ text: "———" }] }];
    case "blockquote":
      return (node.content ?? []).flatMap(nodeToBlocks);
    default:
      return [];
  }
}

export function docToModel(doc: PmNode): DocModel {
  const blocks = (doc.content ?? []).flatMap(nodeToBlocks);
  return { blocks: blocks.length > 0 ? blocks : [{ type: "paragraph", runs: [] }] };
}
