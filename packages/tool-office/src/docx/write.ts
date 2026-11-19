import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Tab,
  Table,
  TableCell as DocxCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from "docx";
import type { Align, Block, DocModel, ImageBlock, ListBlock, Run, TableBlock } from "./model.js";

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
const ALIGN: Record<Align, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};
const LIST_LEVELS = 9;
const MONO = "Consolas";
const PX_TO_EMU_FACTOR = 1; // docx's ImageRun takes pixels
const MAX_IMAGE_WIDTH_PX = 600;
const IMAGE_TYPES: Record<string, "png" | "jpg" | "gif" | "bmp"> = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/gif": "gif", "image/bmp": "bmp" };

const hex = (c: string | undefined) => (c ? c.replace(/^#/, "").toUpperCase() : undefined);

/** One TextRun per line (a "\n" is a break), with real tab elements for "\t". */
function textRuns(run: Run): TextRun[] {
  const formatting = {
    bold: run.bold,
    italics: run.italic,
    underline: run.underline || run.link ? {} : undefined,
    strike: run.strike,
    color: run.link ? (hex(run.color) ?? "0563C1") : hex(run.color),
    font: run.code ? MONO : undefined,
    superScript: run.superscript,
    subScript: run.subscript,
    shading: run.highlight ? { type: ShadingType.CLEAR, fill: hex(run.highlight), color: "auto" } : undefined,
  } as const;
  return run.text.split("\n").map((line, i) => {
    const parts = line.split("\t");
    const children = parts.flatMap((part, p) => (p === 0 ? [part] : [new Tab(), part]));
    return new TextRun({ ...formatting, children, ...(i > 0 ? { break: 1 } : {}) });
  });
}

function runsToChildren(runs: Run[]): ParagraphChild[] {
  return runs.flatMap((run): ParagraphChild[] => {
    const pieces = textRuns(run);
    return run.link ? [new ExternalHyperlink({ children: pieces, link: run.link })] : pieces;
  });
}

function imageRun(block: ImageBlock): ImageRun | null {
  const type = IMAGE_TYPES[block.mime.toLowerCase()];
  if (!type) return null; // svg/webp: Word can't take them through this path
  const width = Math.min(block.width ?? MAX_IMAGE_WIDTH_PX, MAX_IMAGE_WIDTH_PX);
  const ratio = block.width && block.height ? block.height / block.width : 0.6;
  return new ImageRun({
    type,
    data: Buffer.from(block.data, "base64"),
    transformation: { width: width * PX_TO_EMU_FACTOR, height: Math.round(width * ratio) },
    altText: { title: block.alt ?? "", description: block.alt ?? "", name: block.alt ?? "image" },
  });
}

type Ctx = { listInstance: number };

function listParagraphs(list: ListBlock, ctx: Ctx, level = 0, instance = ++ctx.listInstance): Paragraph[] {
  return list.items.flatMap((item) => [
    new Paragraph({
      children: runsToChildren(item.runs),
      numbering: { reference: list.ordered ? "ordered" : "bullet", level: Math.min(level, LIST_LEVELS - 1), instance },
    }),
    ...(item.children ?? []).flatMap((child) => listParagraphs(child, ctx, level + 1, instance)),
  ]);
}

function tableOf(block: TableBlock, ctx: Ctx): Table {
  const border = { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: block.rows.map(
      (row) =>
        new TableRow({
          // Only the header row carries the flag at all: some readers take a present-but-"off" marker as "on".
          tableHeader: row.every((c) => c.header) ? true : undefined,
          children: row.map(
            (cell) =>
              new DocxCell({
                columnSpan: cell.colSpan && cell.colSpan > 1 ? cell.colSpan : undefined,
                shading: cell.header ? { type: ShadingType.CLEAR, fill: "F2F2F2", color: "auto" } : undefined,
                children: (cell.blocks.length > 0 ? cell.blocks : [{ type: "paragraph" as const, runs: [] }]).flatMap((b) => blockToDocx(b, ctx)) as never,
              }),
          ),
        }),
    ),
  });
}

function blockToDocx(block: Block, ctx: Ctx): Array<Paragraph | Table> {
  switch (block.type) {
    case "paragraph":
      return [new Paragraph({ children: runsToChildren(block.runs), alignment: block.align ? ALIGN[block.align] : undefined })];
    case "heading":
      return [new Paragraph({ heading: HEADINGS[block.level - 1], children: runsToChildren(block.runs), alignment: block.align ? ALIGN[block.align] : undefined })];
    case "list":
      return listParagraphs(block, ctx);
    case "table":
      return [tableOf(block, ctx), new Paragraph({ children: [] })];
    case "image": {
      const run = imageRun(block);
      return [new Paragraph({ children: run ? [run] : [] })];
    }
    case "code":
      return block.text.split("\n").map(
        (line) =>
          new Paragraph({
            children: [new TextRun({ text: line, font: MONO, size: 20 })],
            shading: { type: ShadingType.CLEAR, fill: "F2F2F2", color: "auto" },
          }),
      );
    case "pageBreak":
      return [new Paragraph({ children: [new PageBreak()] })];
  }
}

function numbering() {
  const levels = (format: (typeof LevelFormat)[keyof typeof LevelFormat], text: (n: number) => string) =>
    Array.from({ length: LIST_LEVELS }, (_, level) => ({
      level,
      format,
      text: text(level),
      alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
    }));
  return {
    config: [
      { reference: "bullet", levels: levels(LevelFormat.BULLET, (l) => ["•", "◦", "▪"][l % 3]!) },
      { reference: "ordered", levels: levels(LevelFormat.DECIMAL, (l) => `%${l + 1}.`) },
    ],
  };
}

/** Builds a .docx from the model. */
export async function modelToDocx(model: DocModel): Promise<Buffer> {
  const ctx: Ctx = { listInstance: 0 };
  const children = model.blocks.flatMap((b) => blockToDocx(b, ctx));
  const doc = new Document({
    numbering: numbering(),
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    sections: [{ children: children.length > 0 ? children : [new Paragraph({ children: [] })] }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}
