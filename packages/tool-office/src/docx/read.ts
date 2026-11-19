import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import type { Align, Block, DocModel, ImageBlock, ListBlock, ParagraphBlock, Run, TableBlock, TableCell } from "./model.js";

/**
 * .docx → DocModel. Reads the parts of the OOXML a person sees: paragraphs, headings, runs (bold, italic,
 * underline, strike, colour, highlight, super/subscript), hyperlinks, lists (with their levels and whether
 * they are numbered), tables (with merged columns), pictures and page breaks. What it does not read is
 * listed in model.ts; docx/inspect.ts names the common cases so the app can warn.
 */

// With preserveOrder every node is { tag: [children], ":@": { attributes } }, in document order: run order matters.
type XNode = Record<string, unknown> & { ":@"?: Record<string, string> };

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
});

const tagOf = (n: XNode): string => Object.keys(n).find((k) => k !== ":@" && k !== "#text") ?? (n["#text"] !== undefined ? "#text" : "");
const kids = (n: XNode): XNode[] => (Array.isArray(n[tagOf(n)]) ? (n[tagOf(n)] as XNode[]) : []);
const attr = (n: XNode, name: string): string | undefined => n[":@"]?.[`@_${name}`];
const find = (nodes: XNode[], tag: string): XNode | undefined => nodes.find((n) => tagOf(n) === tag);
const textOfNode = (n: XNode): string => kids(n).map((k) => (tagOf(k) === "#text" ? String(k["#text"] ?? "") : "")).join("");

const EMU_PER_PX = 9525;
const DEFAULT_LINK_COLOR = "#0563C1";
const HIGHLIGHT: Record<string, string> = {
  yellow: "#FFFF00", green: "#00FF00", cyan: "#00FFFF", magenta: "#FF00FF", blue: "#0000FF", red: "#FF0000",
  darkBlue: "#000080", darkCyan: "#008080", darkGreen: "#008000", darkMagenta: "#800080", darkRed: "#800000",
  darkYellow: "#808000", darkGray: "#808080", lightGray: "#C0C0C0", black: "#000000", white: "#FFFFFF",
};
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", svg: "image/svg+xml", webp: "image/webp" };

type Ctx = {
  zip: JSZip;
  rels: Map<string, string>;
  /** styleId → lowercased style name ("heading 1"). */
  styles: Map<string, string>;
  /** numId → ordered? */
  numbering: Map<string, Map<number, boolean>>;
};

async function parseXml(zip: JSZip, path: string): Promise<XNode[]> {
  const file = zip.file(path);
  return file ? (parser.parse(await file.async("string")) as XNode[]) : [];
}

async function loadRels(zip: JSZip): Promise<Map<string, string>> {
  const rels = new Map<string, string>();
  const root = find(await parseXml(zip, "word/_rels/document.xml.rels"), "Relationships");
  for (const rel of root ? kids(root) : []) {
    const id = attr(rel, "Id");
    const target = attr(rel, "Target");
    if (id && target) rels.set(id, attr(rel, "TargetMode") === "External" ? target : `word/${target.replace(/^\//, "").replace(/^word\//, "")}`);
  }
  return rels;
}

async function loadStyles(zip: JSZip): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const root = find(await parseXml(zip, "word/styles.xml"), "w:styles");
  for (const style of root ? kids(root).filter((n) => tagOf(n) === "w:style") : []) {
    const id = attr(style, "w:styleId");
    const name = find(kids(style), "w:name");
    if (id && name) out.set(id, (attr(name, "w:val") ?? "").toLowerCase());
  }
  return out;
}

async function loadNumbering(zip: JSZip): Promise<Ctx["numbering"]> {
  const root = find(await parseXml(zip, "word/numbering.xml"), "w:numbering");
  const abstracts = new Map<string, Map<number, boolean>>();
  const result = new Map<string, Map<number, boolean>>();
  for (const node of root ? kids(root) : []) {
    if (tagOf(node) === "w:abstractNum") {
      const levels = new Map<number, boolean>();
      for (const lvl of kids(node).filter((n) => tagOf(n) === "w:lvl")) {
        const fmt = find(kids(lvl), "w:numFmt");
        levels.set(Number(attr(lvl, "w:ilvl") ?? 0), (attr(fmt ?? ({} as XNode), "w:val") ?? "decimal") !== "bullet");
      }
      abstracts.set(attr(node, "w:abstractNumId") ?? "", levels);
    }
  }
  for (const node of root ? kids(root) : []) {
    if (tagOf(node) === "w:num") {
      const abstractId = attr(find(kids(node), "w:abstractNumId") ?? ({} as XNode), "w:val");
      const levels = abstractId ? abstracts.get(abstractId) : undefined;
      if (levels) result.set(attr(node, "w:numId") ?? "", levels);
    }
  }
  return result;
}

const on = (n: XNode | undefined): boolean => !!n && !["0", "false", "off", "none"].includes((attr(n, "w:val") ?? "true").toLowerCase());

function runMarks(rPr: XNode | undefined): Omit<Run, "text"> {
  const marks: Omit<Run, "text"> = {};
  if (!rPr) return marks;
  const props = kids(rPr);
  if (on(find(props, "w:b"))) marks.bold = true;
  if (on(find(props, "w:i"))) marks.italic = true;
  if (on(find(props, "w:strike"))) marks.strike = true;
  const u = find(props, "w:u");
  if (u && attr(u, "w:val") !== "none") marks.underline = true;
  const color = attr(find(props, "w:color") ?? ({} as XNode), "w:val");
  if (color && /^[0-9a-fA-F]{6}$/.test(color)) marks.color = `#${color.toUpperCase()}`;
  const hl = attr(find(props, "w:highlight") ?? ({} as XNode), "w:val");
  const shd = find(props, "w:shd");
  const fill = shd ? attr(shd, "w:fill") : undefined;
  if (hl && HIGHLIGHT[hl]) marks.highlight = HIGHLIGHT[hl];
  else if (fill && /^[0-9a-fA-F]{6}$/.test(fill)) marks.highlight = `#${fill.toUpperCase()}`;
  const va = attr(find(props, "w:vertAlign") ?? ({} as XNode), "w:val");
  if (va === "superscript") marks.superscript = true;
  if (va === "subscript") marks.subscript = true;
  const font = attr(find(props, "w:rFonts") ?? ({} as XNode), "w:ascii");
  if (font && /^(consolas|courier|courier new|menlo|monaco|lucida console)$/i.test(font)) marks.code = true;
  return marks;
}

async function imageFrom(drawing: XNode, ctx: Ctx): Promise<ImageBlock | null> {
  const find2 = (nodes: XNode[], tag: string): XNode | undefined => {
    for (const n of nodes) {
      if (tagOf(n) === tag) return n;
      const deep = find2(kids(n), tag);
      if (deep) return deep;
    }
    return undefined;
  };
  const blip = find2([drawing], "a:blip");
  const embed = blip ? attr(blip, "r:embed") : undefined;
  const path = embed ? ctx.rels.get(embed) : undefined;
  const file = path ? ctx.zip.file(path) : null;
  if (!path || !file) return null;
  const extent = find2([drawing], "wp:extent");
  const cx = Number(extent ? attr(extent, "cx") : 0);
  const cy = Number(extent ? attr(extent, "cy") : 0);
  const docPr = find2([drawing], "wp:docPr");
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return {
    type: "image",
    data: (await file.async("base64")),
    mime: MIME[ext] ?? "application/octet-stream",
    width: cx ? Math.round(cx / EMU_PER_PX) : undefined,
    height: cy ? Math.round(cy / EMU_PER_PX) : undefined,
    alt: docPr ? attr(docPr, "descr") || undefined : undefined,
  };
}

/** Adjacent runs with the same formatting are one run (Word splits text into many for no visible reason). */
export function mergeRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const run of runs) {
    const prev = out[out.length - 1];
    const { text, ...marks } = run;
    if (prev) {
      const { text: prevText, ...prevMarks } = prev;
      if (JSON.stringify(marks) === JSON.stringify(prevMarks)) {
        prev.text = prevText + text;
        continue;
      }
    }
    out.push({ ...run });
  }
  return out;
}

type Parsed = { runs: Run[]; images: ImageBlock[]; pageBreak: boolean };

async function readInline(nodes: XNode[], ctx: Ctx, link?: string): Promise<Parsed> {
  const out: Parsed = { runs: [], images: [], pageBreak: false };
  for (const node of nodes) {
    const tag = tagOf(node);
    if (tag === "w:r") {
      const marks = runMarks(find(kids(node), "w:rPr"));
      if (link) {
        // A hyperlink is shown blue and underlined by default; that is what "link" already means, not extra formatting.
        if (marks.color === DEFAULT_LINK_COLOR) delete marks.color;
        delete marks.underline;
      }
      let text = "";
      const flush = () => {
        if (text) out.runs.push({ ...marks, ...(link ? { link } : {}), text });
        text = "";
      };
      for (const child of kids(node)) {
        const t = tagOf(child);
        if (t === "w:t") text += textOf(child);
        else if (t === "w:tab") text += "\t";
        else if (t === "w:noBreakHyphen") text += "-";
        else if (t === "w:br") {
          if (attr(child, "w:type") === "page") (flush(), (out.pageBreak = true));
          else text += "\n";
        } else if (t === "w:drawing") {
          const image = await imageFrom(child, ctx);
          if (image) out.images.push(image);
        }
      }
      flush();
    } else if (tag === "w:hyperlink") {
      const id = attr(node, "r:id");
      const target = id ? ctx.rels.get(id) : undefined;
      const inner = await readInline(kids(node), ctx, target ?? link);
      out.runs.push(...inner.runs);
      out.images.push(...inner.images);
    } else if (["w:ins", "w:smartTag", "w:fldSimple", "w:sdt", "w:sdtContent"].includes(tag)) {
      const inner = await readInline(kids(node), ctx, link);
      out.runs.push(...inner.runs);
      out.images.push(...inner.images);
      out.pageBreak ||= inner.pageBreak;
    }
  }
  return out;
}

function textOf(node: XNode): string {
  return textOfNode(node);
}

const ALIGN: Record<string, Align> = { left: "left", start: "left", center: "center", right: "right", end: "right", both: "justify", distribute: "justify" };

type ListPara = { ordered: boolean; level: number; runs: Run[]; numId: string };

function buildLists(paras: ListPara[]): ListBlock[] {
  const roots: ListBlock[] = [];
  const stack: Array<{ list: ListBlock; level: number }> = [];
  for (const p of paras) {
    while (stack.length > 0 && stack[stack.length - 1]!.level > p.level) stack.pop();
    let top = stack[stack.length - 1];
    if (!top || top.level < p.level) {
      const list: ListBlock = { type: "list", ordered: p.ordered, items: [] };
      if (top) {
        const parent = top.list.items[top.list.items.length - 1];
        if (parent) (parent.children ??= []).push(list);
        else roots.push(list);
      } else roots.push(list);
      stack.push({ list, level: p.level });
      top = stack[stack.length - 1]!;
    }
    top.list.items.push({ runs: p.runs });
  }
  return roots;
}

async function readBlocks(nodes: XNode[], ctx: Ctx): Promise<Block[]> {
  const blocks: Block[] = [];
  let pendingList: ListPara[] = [];
  const flushList = () => {
    blocks.push(...buildLists(pendingList));
    pendingList = [];
  };

  for (const node of nodes) {
    const tag = tagOf(node);
    if (tag === "w:sdt") {
      const content = find(kids(node), "w:sdtContent");
      flushList();
      if (content) blocks.push(...(await readBlocks(kids(content), ctx)));
      continue;
    }
    if (tag === "w:tbl") {
      flushList();
      blocks.push(await readTable(node, ctx));
      continue;
    }
    if (tag !== "w:p") continue;

    const pPr = find(kids(node), "w:pPr");
    const props = pPr ? kids(pPr) : [];
    const styleId = attr(find(props, "w:pStyle") ?? ({} as XNode), "w:val") ?? "";
    const styleName = ctx.styles.get(styleId) ?? styleId.toLowerCase();
    const heading = /^heading\s?([1-6])$/.exec(styleName)?.[1] ?? (styleName === "title" ? "1" : undefined);
    const align = ALIGN[attr(find(props, "w:jc") ?? ({} as XNode), "w:val") ?? ""];
    const parsed = await readInline(kids(node), ctx);

    const numPr = find(props, "w:numPr");
    const numId = numPr ? attr(find(kids(numPr), "w:numId") ?? ({} as XNode), "w:val") : undefined;
    if (numId && numId !== "0" && !heading) {
      const level = Number(attr(find(kids(numPr!), "w:ilvl") ?? ({} as XNode), "w:val") ?? 0);
      const ordered = ctx.numbering.get(numId)?.get(level) ?? false;
      // A different numbering instance at the top level is a different list, even right after another one
      // (a nested list may use its own numbering, so only level 0 decides).
      const lastRoot = [...pendingList].reverse().find((p) => p.level === 0);
      if (level === 0 && lastRoot && lastRoot.numId !== numId) flushList();
      pendingList.push({ ordered, level, runs: mergeRuns(parsed.runs), numId });
      blocks.push(...parsed.images.length > 0 ? (flushList(), parsed.images) : []);
      continue;
    }
    flushList();

    const runs = mergeRuns(parsed.runs);
    const prev = blocks[blocks.length - 1];
    const onlyBreak = runs.length === 0 && parsed.images.length === 0 && parsed.pageBreak;
    // Word needs a paragraph after every table; the empty one right after it is that, not content.
    const afterTable = runs.length === 0 && parsed.images.length === 0 && prev?.type === "table";
    const hasContent = !onlyBreak && !afterTable && (runs.length > 0 || parsed.images.length === 0);
    if (heading) blocks.push({ type: "heading", level: Number(heading) as 1 | 2 | 3 | 4 | 5 | 6, runs, ...(align ? { align } : {}) });
    else if (hasContent) blocks.push({ type: "paragraph", runs, ...(align ? { align } : {}) } satisfies ParagraphBlock);
    blocks.push(...parsed.images);
    if (parsed.pageBreak) blocks.push({ type: "pageBreak" });
  }
  flushList();
  return blocks;
}

async function readTable(tbl: XNode, ctx: Ctx): Promise<TableBlock> {
  const rows: TableCell[][] = [];
  for (const tr of kids(tbl).filter((n) => tagOf(n) === "w:tr")) {
    const isHeader = on(find(kids(find(kids(tr), "w:trPr") ?? ({} as XNode)), "w:tblHeader"));
    const cells: TableCell[] = [];
    for (const tc of kids(tr).filter((n) => tagOf(n) === "w:tc")) {
      const tcPr = find(kids(tc), "w:tcPr");
      const span = Number(attr(find(tcPr ? kids(tcPr) : [], "w:gridSpan") ?? ({} as XNode), "w:val") ?? 1);
      const blocks = await readBlocks(kids(tc), ctx);
      cells.push({ blocks, ...(isHeader ? { header: true } : {}), ...(span > 1 ? { colSpan: span } : {}) });
    }
    if (cells.length > 0) rows.push(cells);
  }
  return { type: "table", rows };
}

/** Consecutive paragraphs set entirely in a monospace font were a code block when we wrote them: read them back as one. */
function groupCode(blocks: Block[]): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    const isCode = b.type === "paragraph" && b.runs.length > 0 && b.runs.every((r) => r.code && !r.link);
    const prev = out[out.length - 1];
    if (isCode && prev?.type === "code") prev.text += `\n${(b as ParagraphBlock).runs.map((r) => r.text).join("")}`;
    else if (isCode) out.push({ type: "code", text: (b as ParagraphBlock).runs.map((r) => r.text).join("") });
    else if (b.type === "table") out.push({ ...b, rows: b.rows.map((row) => row.map((c) => ({ ...c, blocks: groupCode(c.blocks) }))) });
    else out.push(b);
  }
  return out;
}

export async function docxToModel(data: Uint8Array): Promise<DocModel> {
  const zip = await JSZip.loadAsync(data);
  const document = find(await parseXml(zip, "word/document.xml"), "w:document");
  const body = document ? find(kids(document), "w:body") : undefined;
  if (!body) throw new Error("No es un documento de Word válido (falta word/document.xml)");
  const ctx: Ctx = { zip, rels: await loadRels(zip), styles: await loadStyles(zip), numbering: await loadNumbering(zip) };
  const blocks = groupCode(await readBlocks(kids(body), ctx));
  return { blocks: blocks.length > 0 ? blocks : [{ type: "paragraph", runs: [] }] };
}
