import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import type { ListBlock, Run, TableCell } from "../docx/model.js";
import { CREATOR, THEME_PREFIX } from "./write.js";
import { THEMES, type DeckModel, type DeckTheme, type Slide, type SlideBlock, type SlideLayout } from "./model.js";

/**
 * .pptx → DeckModel. A deck written by write.ts is read back exactly, through the names it gave its shapes.
 * A deck from another app is read as well as it can be (title and subtitle placeholders, text, pictures,
 * tables, notes) and reported as `ours: false`, because its design — master, theme, positions — is not
 * something this model keeps (inspect.ts turns that into the warning).
 */

type XNode = Record<string, unknown> & { ":@"?: Record<string, string> };

const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: "@_", trimValues: false, parseTagValue: false, parseAttributeValue: false });

const tagOf = (n: XNode): string => Object.keys(n).find((k) => k !== ":@" && k !== "#text") ?? (n["#text"] !== undefined ? "#text" : "");
const kids = (n: XNode): XNode[] => (Array.isArray(n[tagOf(n)]) ? (n[tagOf(n)] as XNode[]) : []);
const attr = (n: XNode | undefined, name: string): string | undefined => n?.[":@"]?.[`@_${name}`];
const find = (nodes: XNode[], tag: string): XNode | undefined => nodes.find((n) => tagOf(n) === tag);
const findDeep = (nodes: XNode[], tag: string): XNode | undefined => {
  for (const n of nodes) {
    if (tagOf(n) === tag) return n;
    const d = findDeep(kids(n), tag);
    if (d) return d;
  }
  return undefined;
};
const textOf = (n: XNode): string => kids(n).map((k) => (tagOf(k) === "#text" ? String(k["#text"] ?? "") : "")).join("");

const EMU_PER_PX = 9525;
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", svg: "image/svg+xml" };

const PALETTE_DEFAULTS: Record<DeckTheme, string[]> = {
  light: ["111827", "374151", "6B7280"],
  dark: ["F9FAFB", "E5E7EB", "9CA3AF"],
  accent: ["FFFFFF", "DBEAFE", "93C5FD"],
};

type Ctx = { zip: JSZip; slideRels: Map<string, string>; theme: DeckTheme };

async function parseXml(zip: JSZip, path: string): Promise<XNode[]> {
  const f = zip.file(path);
  return f ? (parser.parse(await f.async("string")) as XNode[]) : [];
}

async function relsOf(zip: JSZip, partPath: string): Promise<Map<string, { target: string; external: boolean }>> {
  const dir = partPath.slice(0, partPath.lastIndexOf("/"));
  const file = partPath.slice(partPath.lastIndexOf("/") + 1);
  const root = find(await parseXml(zip, `${dir}/_rels/${file}.rels`), "Relationships");
  const out = new Map<string, { target: string; external: boolean }>();
  for (const rel of root ? kids(root) : []) {
    const id = attr(rel, "Id");
    const target = attr(rel, "Target");
    if (!id || !target) continue;
    const external = attr(rel, "TargetMode") === "External";
    out.set(id, { target: external ? target : resolvePath(dir, target), external });
  }
  return out;
}

/** "ppt/slides" + "../media/a.png" → "ppt/media/a.png". */
function resolvePath(dir: string, target: string): string {
  const parts = (target.startsWith("/") ? target.slice(1) : `${dir}/${target}`).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p !== ".") out.push(p);
  }
  return out.join("/");
}

// ---- text ----------------------------------------------------------------------------------------

function runFrom(r: XNode, rels: Map<string, { target: string; external: boolean }>, theme: DeckTheme, keepBold: boolean): Run | null {
  const rPr = find(kids(r), "a:rPr");
  const text = kids(r).filter((k) => tagOf(k) === "a:t").map(textOf).join("");
  if (!text) return null;
  const run: Run = { text };
  if (rPr) {
    if (attr(rPr, "b") === "1" && keepBold) run.bold = true;
    if (attr(rPr, "i") === "1") run.italic = true;
    if (attr(rPr, "strike") && attr(rPr, "strike") !== "noStrike") run.strike = true;
    const u = attr(rPr, "u");
    const baseline = Number(attr(rPr, "baseline") ?? 0);
    if (baseline > 0) run.superscript = true;
    if (baseline < 0) run.subscript = true;
    const props = kids(rPr);
    const fill = find(props, "a:solidFill");
    const rgb = attr(findDeep(fill ? kids(fill) : [], "a:srgbClr"), "val")?.toUpperCase();
    // Our writer paints every run in the theme's text colours; that is the default, not a choice.
    if (rgb && !PALETTE_DEFAULTS[theme].includes(rgb)) run.color = `#${rgb}`;
    const hl = find(props, "a:highlight");
    const hlRgb = attr(hl ? findDeep(kids(hl), "a:srgbClr") : undefined, "val");
    if (hlRgb) run.highlight = `#${hlRgb.toUpperCase()}`;
    const latin = attr(find(props, "a:latin"), "typeface");
    if (latin && /^(consolas|courier|courier new|menlo|monaco)$/i.test(latin)) run.code = true;
    const link = find(props, "a:hlinkClick");
    const rid = link ? attr(link, "r:id") : undefined;
    const target = rid ? rels.get(rid) : undefined;
    if (target?.external) run.link = target.target;
    // A link is drawn underlined by default: that is what "link" already means.
    if (u && u !== "none" && !run.link) run.underline = true;
  }
  return run;
}

type Para = { runs: Run[]; level: number; bullet: "none" | "bullet" | "number"; align?: string };

function paragraphsOf(txBody: XNode | undefined, rels: Map<string, { target: string; external: boolean }>, theme: DeckTheme, keepBold = true): Para[] {
  const out: Para[] = [];
  for (const p of txBody ? kids(txBody).filter((n) => tagOf(n) === "a:p") : []) {
    const pPr = find(kids(p), "a:pPr");
    const props = pPr ? kids(pPr) : [];
    const runs: Run[] = [];
    for (const child of kids(p)) {
      const tag = tagOf(child);
      if (tag === "a:r") {
        const run = runFrom(child, rels, theme, keepBold);
        if (run) runs.push(run);
      } else if (tag === "a:br") runs.push({ text: "\n" });
      else if (tag === "a:fld") {
        const t = kids(child).filter((k) => tagOf(k) === "a:t").map(textOf).join("");
        if (t) runs.push({ text: t });
      }
    }
    out.push({
      runs: mergeRuns(runs),
      level: Number(attr(pPr, "lvl") ?? 0),
      bullet: find(props, "a:buAutoNum") ? "number" : find(props, "a:buChar") ? "bullet" : "none",
      align: attr(pPr, "algn"),
    });
  }
  return out;
}

function mergeRuns(runs: Run[]): Run[] {
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

const ALIGN: Record<string, "center" | "right" | "justify"> = { ctr: "center", r: "right", just: "justify" };

/** Paragraphs → blocks: bullets become (nested) lists, everything else paragraphs. */
function paragraphsToBlocks(paras: Para[]): SlideBlock[] {
  const blocks: SlideBlock[] = [];
  let items: Para[] = [];
  const flush = () => {
    if (items.length === 0) return;
    blocks.push(...buildLists(items));
    items = [];
  };
  for (const p of paras) {
    if (p.bullet !== "none") {
      // A switch between bullets and numbers at the top level is a different list.
      const last = items[items.length - 1];
      if (last && p.level === 0 && last.level === 0 && last.bullet !== p.bullet) flush();
      items.push(p);
    } else {
      flush();
      if (p.runs.length === 0) continue; // an empty line is spacing, not content
      blocks.push({ type: "paragraph", runs: p.runs, ...(p.align && ALIGN[p.align] ? { align: ALIGN[p.align] } : {}) });
    }
  }
  flush();
  return blocks;
}

function buildLists(paras: Para[]): ListBlock[] {
  const roots: ListBlock[] = [];
  const stack: Array<{ list: ListBlock; level: number }> = [];
  for (const p of paras) {
    while (stack.length > 0 && stack[stack.length - 1]!.level > p.level) stack.pop();
    let top = stack[stack.length - 1];
    if (!top || top.level < p.level) {
      const list: ListBlock = { type: "list", ordered: p.bullet === "number", items: [] };
      const parent = top?.list.items[top.list.items.length - 1];
      if (parent) (parent.children ??= []).push(list);
      else roots.push(list);
      stack.push({ list, level: p.level });
      top = stack[stack.length - 1]!;
    }
    top.list.items.push({ runs: p.runs });
  }
  return roots;
}

// ---- shapes --------------------------------------------------------------------------------------

type Shape = { name: string; ph?: string; kind: "text" | "table" | "image"; node: XNode; y: number };

function shapesOf(spTree: XNode): { shapes: Shape[]; grouped: boolean } {
  const shapes: Shape[] = [];
  let grouped = false;
  for (const n of kids(spTree)) {
    const tag = tagOf(n);
    const yOf = (xfrmHolder: XNode | undefined) => Number(attr(findDeep(xfrmHolder ? kids(xfrmHolder) : [], "a:off"), "y") ?? 0);
    if (tag === "p:sp") {
      const nv = find(kids(n), "p:nvSpPr");
      const cNvPr = find(nv ? kids(nv) : [], "p:cNvPr");
      const ph = find(find(nv ? kids(nv) : [], "p:nvPr") ? kids(find(nv ? kids(nv) : [], "p:nvPr")!) : [], "p:ph");
      shapes.push({ name: attr(cNvPr, "name") ?? "", ph: attr(ph, "type"), kind: "text", node: n, y: yOf(find(kids(n), "p:spPr")) });
    } else if (tag === "p:pic") {
      const nv = find(kids(n), "p:nvPicPr");
      shapes.push({ name: attr(find(nv ? kids(nv) : [], "p:cNvPr"), "name") ?? "", kind: "image", node: n, y: yOf(find(kids(n), "p:spPr")) });
    } else if (tag === "p:graphicFrame") {
      const nv = find(kids(n), "p:nvGraphicFramePr");
      shapes.push({ name: attr(find(nv ? kids(nv) : [], "p:cNvPr"), "name") ?? "", kind: "table", node: n, y: yOf(find(kids(n), "p:xfrm")) });
    } else if (tag === "p:grpSp") grouped = true;
  }
  return { shapes, grouped };
}

async function imageBlock(pic: XNode, slideRels: Map<string, { target: string; external: boolean }>, zip: JSZip): Promise<SlideBlock | null> {
  const blip = findDeep([pic], "a:blip");
  const rel = blip ? slideRels.get(attr(blip, "r:embed") ?? "") : undefined;
  const file = rel ? zip.file(rel.target) : null;
  if (!rel || !file) return null;
  const ext = findDeep([pic], "a:ext");
  const cx = Number(attr(ext, "cx") ?? 0);
  const cy = Number(attr(ext, "cy") ?? 0);
  const cNvPr = findDeep([pic], "p:cNvPr");
  const alt = attr(cNvPr, "descr");
  return {
    type: "image",
    data: await file.async("base64"),
    mime: MIME[rel.target.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream",
    ...(cx ? { width: Math.round(cx / EMU_PER_PX) } : {}),
    ...(cy ? { height: Math.round(cy / EMU_PER_PX) } : {}),
    ...(alt ? { alt } : {}),
  };
}

function tableBlock(frame: XNode, rels: Map<string, { target: string; external: boolean }>, theme: DeckTheme): SlideBlock | null {
  const tbl = findDeep([frame], "a:tbl");
  if (!tbl) return null;
  const rows: TableCell[][] = [];
  kids(tbl).filter((n) => tagOf(n) === "a:tr").forEach((tr, rowIndex) => {
    const cells: TableCell[] = [];
    for (const tc of kids(tr).filter((n) => tagOf(n) === "a:tc")) {
      if (attr(tc, "hMerge") === "1" || attr(tc, "vMerge") === "1") continue;
      const paras = paragraphsOf(find(kids(tc), "a:txBody"), rels, theme, true);
      const runs = mergeRuns(paras.flatMap((p, i) => (i === 0 ? p.runs : [{ text: "\n" }, ...p.runs])));
      const bold = runs.length > 0 && runs.every((r) => r.bold);
      const span = Number(attr(tc, "gridSpan") ?? 1);
      cells.push({
        blocks: [{ type: "paragraph", runs: bold && rowIndex === 0 ? runs.map(({ bold: _b, ...r }) => r) : runs }],
        ...(rowIndex === 0 && bold ? { header: true } : {}),
        ...(span > 1 ? { colSpan: span } : {}),
      });
    }
    if (cells.length > 0) rows.push(cells);
  });
  return { type: "table", rows };
}

async function readSlot(shapes: Shape[], ctx: Ctx, rels: Map<string, { target: string; external: boolean }>): Promise<SlideBlock[]> {
  const blocks: SlideBlock[] = [];
  const ordered = [...shapes].sort((a, b) => Number(/#(\d+):/.exec(a.name)?.[1] ?? 0) - Number(/#(\d+):/.exec(b.name)?.[1] ?? 0));
  for (const shape of ordered) {
    const kind = /:([a-z0-9]+)$/.exec(shape.name)?.[1] ?? "text";
    if (shape.kind === "image") {
      const img = await imageBlock(shape.node, rels, ctx.zip);
      if (img) blocks.push(img);
    } else if (shape.kind === "table") {
      const t = tableBlock(shape.node, rels, ctx.theme);
      if (t) blocks.push(t);
    } else {
      const paras = paragraphsOf(find(kids(shape.node), "p:txBody"), rels, ctx.theme, kind !== "code" && !/^h\d$/.test(kind));
      if (kind === "code") blocks.push({ type: "code", text: paras.map((p) => p.runs.map((r) => r.text).join("")).join("\n") });
      else if (/^h[1-6]$/.test(kind)) blocks.push({ type: "heading", level: Number(kind[1]) as 1 | 2 | 3 | 4 | 5 | 6, runs: paras.flatMap((p) => p.runs) });
      else blocks.push(...paragraphsToBlocks(paras));
    }
  }
  return blocks;
}

const LAYOUT_NAMES: SlideLayout[] = ["title", "content", "section", "two-column", "blank"];

async function readSlide(path: string, ctx: Ctx, index: number): Promise<{ slide: Slide; ours: boolean }> {
  const root = find(await parseXml(ctx.zip, path), "p:sld");
  const cSld = root ? find(kids(root), "p:cSld") : undefined;
  const spTree = cSld ? find(kids(cSld), "p:spTree") : undefined;
  const rels = await relsOf(ctx.zip, path);
  const { shapes } = spTree ? shapesOf(spTree) : { shapes: [] as Shape[] };
  const ours = shapes.some((s) => s.name.startsWith("yg:"));
  let slide: Slide;

  if (ours) {
    const named = (prefix: string) => shapes.filter((s) => s.name === prefix || s.name.startsWith(`${prefix}#`) || s.name.startsWith(`${prefix}|`));
    const titleShape = shapes.find((s) => s.name.startsWith("yg:title"));
    const layoutName = /\|(.+)$/.exec(titleShape?.name ?? "")?.[1] as SlideLayout | undefined;
    const titleRuns = titleShape ? paragraphsOf(find(kids(titleShape.node), "p:txBody"), rels, ctx.theme, false).flatMap((p) => p.runs) : [];
    const subtitleShape = shapes.find((s) => s.name === "yg:subtitle");
    const subtitle = subtitleShape ? paragraphsOf(find(kids(subtitleShape.node), "p:txBody"), rels, ctx.theme, true).flatMap((p) => p.runs) : [];
    slide = {
      layout: layoutName && LAYOUT_NAMES.includes(layoutName) ? layoutName : "content",
      title: titleRuns,
      body: await readSlot(named("yg:body"), ctx, rels),
    };
    if (subtitle.length > 0) slide.subtitle = subtitle;
    const two = named("yg:body2");
    if (slide.layout === "two-column") slide.body2 = await readSlot(two, ctx, rels);
  } else {
    const title = shapes.find((s) => s.ph === "title" || s.ph === "ctrTitle");
    const sub = shapes.find((s) => s.ph === "subTitle");
    const body: SlideBlock[] = [];
    for (const s of shapes) {
      if (s === title || s === sub) continue;
      if (s.kind === "image") {
        const img = await imageBlock(s.node, rels, ctx.zip);
        if (img) body.push(img);
      } else if (s.kind === "table") {
        const t = tableBlock(s.node, rels, ctx.theme);
        if (t) body.push(t);
      } else body.push(...paragraphsToBlocks(paragraphsOf(find(kids(s.node), "p:txBody"), rels, ctx.theme)));
    }
    const titleRuns = title ? paragraphsOf(find(kids(title.node), "p:txBody"), rels, ctx.theme).flatMap((p) => p.runs) : [];
    const subRuns = sub ? paragraphsOf(find(kids(sub.node), "p:txBody"), rels, ctx.theme).flatMap((p) => p.runs) : [];
    slide = { layout: sub || (index === 0 && body.length === 0) ? "title" : "content", title: titleRuns, body };
    if (subRuns.length > 0) slide.subtitle = subRuns;
  }

  // Speaker notes: the notes page's body placeholder.
  const notesRel = [...rels.values()].find((r) => /notesSlides\//.test(r.target));
  if (notesRel) {
    const notesRoot = find(await parseXml(ctx.zip, notesRel.target), "p:notes");
    const tree = notesRoot ? find(kids(find(kids(notesRoot), "p:cSld") ?? ({} as XNode)), "p:spTree") : undefined;
    const body = tree ? shapesOf(tree).shapes.find((s) => s.ph === "body") : undefined;
    const text = body ? paragraphsOf(find(kids(body.node), "p:txBody"), new Map(), ctx.theme).map((p) => p.runs.map((r) => r.text).join("")).join("\n").trim() : "";
    if (text) slide.notes = text;
  }
  return { slide, ours };
}

export type ReadDeck = { deck: DeckModel; /** Written by this app (so fully modelled), not by another one. */ ours: boolean };

export async function pptxToDeck(data: Uint8Array): Promise<ReadDeck> {
  const zip = await JSZip.loadAsync(data);
  const core = (await zip.file("docProps/core.xml")?.async("string")) ?? "";
  const creator = /<dc:creator>([^<]*)<\/dc:creator>/.exec(core)?.[1];
  const lastModifiedBy = /<cp:lastModifiedBy>([^<]*)<\/cp:lastModifiedBy>/.exec(core)?.[1];
  const subject = /<dc:subject>([^<]*)<\/dc:subject>/.exec(core)?.[1] ?? "";
  const themeName = subject.startsWith(THEME_PREFIX) ? subject.slice(THEME_PREFIX.length) : "light";
  const theme = (THEMES as string[]).includes(themeName) ? (themeName as DeckTheme) : "light";

  const presentation = find(await parseXml(zip, "ppt/presentation.xml"), "p:presentation");
  if (!presentation) throw new Error("No es una presentación válida (falta ppt/presentation.xml)");
  const presRels = await relsOf(zip, "ppt/presentation.xml");
  const idList = find(kids(presentation), "p:sldIdLst");
  const paths = (idList ? kids(idList) : []).map((n) => presRels.get(attr(n, "r:id") ?? "")?.target).filter((p): p is string => !!p);

  const ctx: Ctx = { zip, slideRels: new Map(), theme };
  const slides: Slide[] = [];
  let everySlideOurs = true;
  for (const [i, path] of paths.entries()) {
    const { slide, ours } = await readSlide(path, ctx, i);
    slides.push(slide);
    everySlideOurs &&= ours;
  }
  // "Ours" means written by this app AND not saved since by another one (PowerPoint changes lastModifiedBy).
  return { deck: { theme, slides }, ours: creator === CREATOR && lastModifiedBy === CREATOR && everySlideOurs && slides.length > 0 };
}
