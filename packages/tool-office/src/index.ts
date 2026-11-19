import { definePlugin } from "@yggdrasil/sdk";
import { officeTools } from "./tools.js";

export { xlsxToSnapshot, snapshotToXlsx, newSnapshot, argbToHex, hexToArgb } from "./xlsx/convert.js";
export type { WorkbookSnapshot, SheetSnapshot, CellData, StyleData, MergeRange } from "./xlsx/snapshot.js";
export { patchXlsx } from "./xlsx/patch.js";
export { inspectLossyFeatures } from "./xlsx/inspect.js";
export { docxToModel } from "./docx/read.js";
export { modelToDocx } from "./docx/write.js";
export { inspectDocxLossy } from "./docx/inspect.js";
export { textOf, EMPTY_DOC } from "./docx/model.js";
export type { DocModel, Block, Run, ParagraphBlock, HeadingBlock, ListBlock, ListItem, TableBlock, TableCell, ImageBlock, CodeBlock, PageBreakBlock, Align } from "./docx/model.js";
export { pptxToDeck } from "./pptx/read.js";
export { deckToPptx } from "./pptx/write.js";
export { inspectPptxLossy } from "./pptx/inspect.js";
export { parseDeckMarkdown, deckToMarkdown, slideToMarkdown } from "./pptx/deckMarkdown.js";
export { parseBlocks, blocksToMarkdown, parseInline, runsToMarkdown } from "./markdown.js";
export { emptyDeck, LAYOUTS, THEMES } from "./pptx/model.js";
export type { DeckModel, Slide, SlideBlock, SlideLayout, DeckTheme } from "./pptx/model.js";
export { officeTools } from "./tools.js";

const plugin = definePlugin({
  id: "tool-office",
  name: "Office Tools",
  version: "0.1.0",
  register(api) {
    for (const tool of officeTools) {
      api.registerTool(tool);
      api.logger.info("registered office tool", { name: tool.name });
    }
  },
});

export default plugin;
