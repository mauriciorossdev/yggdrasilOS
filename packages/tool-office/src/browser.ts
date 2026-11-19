/**
 * The browser-safe half of the package: the document/deck models and the Markdown dialect, all pure. The renderer
 * imports from here (`@yggdrasil/tool-office/browser`) so it never bundles the Node-oriented readers/writers
 * (exceljs, docx, pptxgenjs, jszip) that only the main process uses.
 */
export { parseDeckMarkdown, deckToMarkdown, slideToMarkdown } from "./pptx/deckMarkdown.js";
export { parseBlocks, blocksToMarkdown, parseInline, runsToMarkdown } from "./markdown.js";
export { emptyDeck, LAYOUTS, THEMES } from "./pptx/model.js";
export { textOf, EMPTY_DOC } from "./docx/model.js";
export type { DocModel, Block, Run, ParagraphBlock, HeadingBlock, ListBlock, ListItem, TableBlock, TableCell, ImageBlock, CodeBlock, PageBreakBlock, Align } from "./docx/model.js";
export type { DeckModel, Slide, SlideBlock, SlideLayout, DeckTheme } from "./pptx/model.js";
export type { WorkbookSnapshot, SheetSnapshot, CellData, StyleData, MergeRange } from "./xlsx/snapshot.js";
