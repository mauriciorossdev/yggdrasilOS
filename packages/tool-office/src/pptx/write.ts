import PptxModule from "pptxgenjs";
import type { Run } from "../docx/model.js";
import type { DeckModel, DeckTheme, Slide, SlideBlock } from "./model.js";

/**
 * DeckModel → .pptx. Every shape gets a name that says what it is (yg:title, yg:body#0:text, …) so that
 * read.ts can rebuild exactly this structure; that is also how a deck written here is told apart from one
 * made in another app (see inspect.ts). The design (positions, colours, fonts) comes from the theme.
 */

// pptxgenjs is CommonJS: at runtime the default import is the class itself, while its type definitions
// describe it as a module with a `default`. Accept both so the code is right for the runtime and the checker.
type PptxCtor = typeof import("pptxgenjs").default;
const PptxGenJS: PptxCtor = ((PptxModule as unknown as { default?: PptxCtor }).default ?? (PptxModule as unknown as PptxCtor)) as PptxCtor;
type PptxInstance = InstanceType<PptxCtor>;
type PptxSlide = ReturnType<PptxInstance["addSlide"]>;

export const CREATOR = "Yggdrasil";
export const THEME_PREFIX = "yg-theme:";

// Slide is 13.333 x 7.5 inches (LAYOUT_WIDE).
const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const MARGIN_X = 0.7;
const CONTENT_W = SLIDE_W - MARGIN_X * 2;
const FONT = "Calibri";
const MONO = "Consolas";
const PX_PER_INCH = 96;

type Palette = { bg: string; title: string; text: string; accent: string; muted: string; tableHead: string; codeBg: string };

const PALETTES: Record<DeckTheme, Palette> = {
  light: { bg: "FFFFFF", title: "111827", text: "374151", accent: "2563EB", muted: "6B7280", tableHead: "E5E7EB", codeBg: "F3F4F6" },
  dark: { bg: "111827", title: "F9FAFB", text: "E5E7EB", accent: "60A5FA", muted: "9CA3AF", tableHead: "374151", codeBg: "1F2937" },
  accent: { bg: "1E3A8A", title: "FFFFFF", text: "DBEAFE", accent: "FBBF24", muted: "93C5FD", tableHead: "1E40AF", codeBg: "1E40AF" },
};

type Area = { x: number; y: number; w: number; h: number };

function textRun(run: Run, base: { color: string; fontSize: number; bold?: boolean }, extra: Record<string, unknown> = {}) {
  return {
    text: run.text,
    options: {
      fontFace: run.code ? MONO : FONT,
      fontSize: base.fontSize,
      color: run.color ? run.color.replace(/^#/, "") : base.color,
      bold: run.bold || base.bold || undefined,
      italic: run.italic || undefined,
      underline: run.underline || run.link ? { style: "sng" as const } : undefined,
      strike: run.strike ? ("sngStrike" as const) : undefined,
      superscript: run.superscript || undefined,
      subscript: run.subscript || undefined,
      highlight: run.highlight ? run.highlight.replace(/^#/, "") : undefined,
      hyperlink: run.link ? { url: run.link } : undefined,
      ...extra,
    },
  };
}

/** A paragraph as pptxgenjs runs: paragraph-level options ride on the first run, the break on the last. */
function paragraph(runs: Run[], base: { color: string; fontSize: number; bold?: boolean }, para: Record<string, unknown> = {}) {
  const pieces = (runs.length > 0 ? runs : [{ text: "" }]).map((r) => textRun(r, base));
  Object.assign(pieces[0]!.options, para);
  (pieces[pieces.length - 1]!.options as Record<string, unknown>).breakLine = true;
  return pieces;
}

function estimateLines(text: string, widthIn: number, fontSize: number): number {
  const charsPerLine = Math.max(8, Math.floor(widthIn * 8.6 * (20 / fontSize)));
  return text.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
}
const lineHeightIn = (fontSize: number) => (fontSize * 1.3) / 72;
const plain = (runs: Run[]) => runs.map((r) => r.text).join("");

function listParagraphs(block: Extract<SlideBlock, { type: "list" }>, base: { color: string; fontSize: number }, palette: Palette, level = 0): { runs: ReturnType<typeof paragraph>; text: string }[] {
  return block.items.flatMap((item) => [
    {
      runs: paragraph(item.runs, base, { bullet: block.ordered ? { type: "number" as const } : { characterCode: "2022", color: palette.accent }, indentLevel: level }),
      text: plain(item.runs),
    },
    ...(item.children ?? []).flatMap((child) => listParagraphs(child, base, palette, level + 1)),
  ]);
}

/** Places a slot's blocks top to bottom inside `area`, each in a shape named for its slot and kind. */
function placeBlocks(slide: PptxSlide, blocks: SlideBlock[], area: Area, slot: string, palette: Palette, fontSize: number): void {
  let y = area.y;
  const bottom = area.y + area.h;
  let group = 0;
  let pending: { runs: ReturnType<typeof paragraph>; text: string }[] = [];
  const base = { color: palette.text, fontSize };

  const flushText = () => {
    if (pending.length === 0) return;
    const lines = pending.reduce((n, p) => n + estimateLines(p.text, area.w - 0.3, fontSize), 0);
    const h = Math.min(bottom - y, Math.max(0.4, lines * lineHeightIn(fontSize) + 0.2));
    slide.addText(pending.flatMap((p) => p.runs) as never, { x: area.x, y, w: area.w, h, valign: "top", margin: [2, 4, 2, 4], fit: "shrink", objectName: `yg:${slot}#${group++}:text` });
    y += h + 0.1;
    pending = [];
  };

  for (const block of blocks) {
    if (block.type === "paragraph") {
      pending.push({ runs: paragraph(block.runs, base, block.align ? { align: block.align } : {}), text: plain(block.runs) });
    } else if (block.type === "list") {
      pending.push(...listParagraphs(block, base, palette));
    } else if (block.type === "heading") {
      flushText();
      const size = Math.round(fontSize * (block.level <= 2 ? 1.4 : 1.2));
      const h = lineHeightIn(size) * estimateLines(plain(block.runs), area.w, size) + 0.15;
      slide.addText(paragraph(block.runs, { color: palette.title, fontSize: size, bold: true }) as never, { x: area.x, y, w: area.w, h, valign: "top", margin: [2, 4, 2, 4], objectName: `yg:${slot}#${group++}:h${block.level}` });
      y += h + 0.05;
    } else if (block.type === "table") {
      flushText();
      const rows = block.rows.map((row) =>
        row.map((cell) => {
          const runs = cell.blocks.flatMap((b) => (b.type === "paragraph" ? b.runs : []));
          return {
            text: (runs.length > 0 ? runs : [{ text: "" }]).map((r) => textRun(r, { color: palette.text, fontSize: Math.max(12, fontSize - 4), bold: cell.header })) as never,
            options: { ...(cell.header ? { fill: { color: palette.tableHead }, bold: true } : {}), ...(cell.colSpan && cell.colSpan > 1 ? { colspan: cell.colSpan } : {}) },
          };
        }),
      );
      const h = Math.min(bottom - y, rows.length * 0.45);
      slide.addTable(rows as never, { x: area.x, y, w: area.w, border: { type: "solid", pt: 0.75, color: palette.muted }, fontFace: FONT, valign: "middle", objectName: `yg:${slot}#${group++}:table` });
      y += h + 0.15;
    } else if (block.type === "image") {
      flushText();
      const ratio = block.width && block.height ? block.height / block.width : 0.6;
      let w = Math.min((block.width ?? 480) / PX_PER_INCH, area.w);
      let h = w * ratio;
      if (h > bottom - y) {
        h = Math.max(0.5, bottom - y);
        w = h / ratio;
      }
      slide.addImage({ data: `${block.mime};base64,${block.data}`, x: area.x, y, w, h, altText: block.alt, objectName: `yg:${slot}#${group++}:image` });
      y += h + 0.15;
    } else if (block.type === "code") {
      flushText();
      const lines = block.text.split("\n");
      const size = Math.max(11, fontSize - 6);
      const h = Math.min(bottom - y, lines.length * lineHeightIn(size) + 0.3);
      const runs = lines.flatMap((line) => paragraph([{ text: line, code: true }], { color: palette.text, fontSize: size }));
      slide.addText(runs as never, { x: area.x, y, w: area.w, h, valign: "top", fill: { color: palette.codeBg }, margin: [6, 8, 6, 8], fit: "shrink", objectName: `yg:${slot}#${group++}:code` });
      y += h + 0.1;
    }
  }
  flushText();
}

function addTitle(slide: PptxSlide, s: Slide, palette: Palette, geometry: Area & { size: number; align?: "left" | "center" }): void {
  slide.addText(paragraph(s.title, { color: palette.title, fontSize: geometry.size, bold: true }, { align: geometry.align ?? "left" }) as never, {
    x: geometry.x, y: geometry.y, w: geometry.w, h: geometry.h, valign: "middle", margin: [2, 4, 2, 4], fit: "shrink",
    objectName: `yg:title|${s.layout}`,
  });
}

function addSubtitle(slide: PptxSlide, s: Slide, palette: Palette, geometry: Area & { align?: "left" | "center" }): void {
  if (!s.subtitle || s.subtitle.length === 0) return;
  slide.addText(paragraph(s.subtitle, { color: palette.muted, fontSize: 22 }, { align: geometry.align ?? "left" }) as never, {
    x: geometry.x, y: geometry.y, w: geometry.w, h: geometry.h, valign: "top", margin: [2, 4, 2, 4], fit: "shrink", objectName: "yg:subtitle",
  });
}

function drawSlide(pptx: PptxInstance, s: Slide, palette: Palette): void {
  const slide = pptx.addSlide();
  slide.background = { color: palette.bg };

  switch (s.layout) {
    case "title":
      slide.addShape("rect", { x: SLIDE_W / 2 - 1, y: 4.0, w: 2, h: 0.06, fill: { color: palette.accent }, line: { color: palette.accent, width: 0 }, objectName: "yg:decor" });
      addTitle(slide, s, palette, { x: MARGIN_X, y: 1.9, w: CONTENT_W, h: 2.0, size: 44, align: "center" });
      addSubtitle(slide, s, palette, { x: MARGIN_X, y: 4.3, w: CONTENT_W, h: 1.2, align: "center" });
      if (s.body.length > 0) placeBlocks(slide, s.body, { x: MARGIN_X, y: 5.6, w: CONTENT_W, h: 1.5 }, "body", palette, 16);
      break;
    case "section":
      slide.addShape("rect", { x: 0, y: 0, w: 0.35, h: SLIDE_H, fill: { color: palette.accent }, line: { color: palette.accent, width: 0 }, objectName: "yg:decor" });
      addTitle(slide, s, palette, { x: 1.2, y: 2.6, w: SLIDE_W - 2.4, h: 1.6, size: 40 });
      addSubtitle(slide, s, palette, { x: 1.2, y: 4.3, w: SLIDE_W - 2.4, h: 1.2 });
      if (s.body.length > 0) placeBlocks(slide, s.body, { x: 1.2, y: 5.6, w: SLIDE_W - 2.4, h: 1.5 }, "body", palette, 16);
      break;
    case "two-column": {
      slide.addShape("rect", { x: MARGIN_X, y: 1.45, w: 1.2, h: 0.05, fill: { color: palette.accent }, line: { color: palette.accent, width: 0 }, objectName: "yg:decor" });
      addTitle(slide, s, palette, { x: MARGIN_X, y: 0.4, w: CONTENT_W, h: 1.0, size: 32 });
      const colW = (CONTENT_W - 0.5) / 2;
      placeBlocks(slide, s.body, { x: MARGIN_X, y: 1.8, w: colW, h: 5.2 }, "body", palette, 18);
      placeBlocks(slide, s.body2 ?? [], { x: MARGIN_X + colW + 0.5, y: 1.8, w: colW, h: 5.2 }, "body2", palette, 18);
      break;
    }
    case "blank":
      // A blank slide has no title to carry its name, and the reader needs to know it is ours: an invisible marker.
      slide.addText("", { x: 0, y: 0, w: 0.01, h: 0.01, objectName: "yg:title|blank" });
      placeBlocks(slide, s.body, { x: MARGIN_X, y: 0.7, w: CONTENT_W, h: 6.2 }, "body", palette, 20);
      break;
    default:
      slide.addShape("rect", { x: MARGIN_X, y: 1.45, w: 1.2, h: 0.05, fill: { color: palette.accent }, line: { color: palette.accent, width: 0 }, objectName: "yg:decor" });
      addTitle(slide, s, palette, { x: MARGIN_X, y: 0.4, w: CONTENT_W, h: 1.0, size: 32 });
      placeBlocks(slide, s.body, { x: MARGIN_X, y: 1.8, w: CONTENT_W, h: 5.2 }, "body", palette, 20);
  }
  if (s.notes) slide.addNotes(s.notes);
}

export async function deckToPptx(deck: DeckModel): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = CREATOR;
  pptx.company = CREATOR;
  pptx.subject = `${THEME_PREFIX}${deck.theme}`;
  pptx.title = deck.slides[0]?.title.map((r) => r.text).join("") || "Presentation";
  const palette = PALETTES[deck.theme];
  for (const s of deck.slides.length > 0 ? deck.slides : [{ layout: "blank" as const, title: [], body: [] }]) drawSlide(pptx, s, palette);
  return (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
}
