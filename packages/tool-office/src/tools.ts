import { defineTool } from "@yggdrasil/tools-sdk";
import { callEditor } from "./editorClient.js";

const PATH_HELP = "Path of the .xlsx file relative to the project root, e.g. \"notes/budget.xlsx\".";

export const sheetCreateTool = defineTool({
  name: "sheet_create",
  description:
    "Creates a new spreadsheet (.xlsx) and opens it in the workspace beside the chat, where the user sees it and can edit it by hand. " +
    "Optionally fills it with `rows`. Refuses to overwrite an existing file. Use sheet_write_range afterwards to keep editing the same open sheet.",
  riskLevel: "moderate",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: PATH_HELP },
      rows: {
        type: "array",
        description:
          "Optional initial contents as rows of cells, starting at A1. A cell is a string, number, boolean or null (empty). A string starting with \"=\" is a formula, e.g. \"=SUM(B2:B4)\".",
        items: { type: "array", items: {} },
      },
    },
    required: ["path"],
  },
  async execute(_ctx, params) {
    return callEditor("sheet", "create", { path: params.path, rows: params.rows });
  },
});

export const sheetOpenTool = defineTool({
  name: "sheet_open",
  description:
    "Opens an existing spreadsheet (.xlsx) in the workspace beside the chat and returns its sheet names and used range. " +
    "Call this before reading or writing a file the user has not opened yet.",
  riskLevel: "safe",
  parameters: { type: "object", properties: { path: { type: "string", description: PATH_HELP } }, required: ["path"] },
  async execute(_ctx, params) {
    return callEditor("sheet", "open", { path: params.path });
  },
});

export const sheetReadRangeTool = defineTool({
  name: "sheet_read_range",
  description:
    "Reads a range of the spreadsheet the user has open (opens it if needed). Returns `values` (formula cells hold their calculated result; empty cells are null) " +
    "and `formulas` (the formula text where a cell has one). Use A1 notation like \"A1:D20\". At most 5000 cells per call.",
  riskLevel: "safe",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: PATH_HELP },
      range: { type: "string", description: "A1 notation, e.g. \"A1:C10\"." },
      sheet: { type: "string", description: "Sheet name; defaults to the sheet that is showing." },
    },
    required: ["path", "range"],
  },
  async execute(_ctx, params) {
    return callEditor("sheet", "read", { path: params.path, range: params.range, sheet: params.sheet });
  },
});

export const sheetWriteRangeTool = defineTool({
  name: "sheet_write_range",
  description:
    "Writes cells into the spreadsheet the user has open, live: the change appears on screen right away and is saved to the file. " +
    "`values` is a rectangular 2D array (rows of cells) written with its top-left cell at the start of `range`. A cell is a string, number, boolean or null (clears the cell); " +
    "a string starting with \"=\" is a formula, e.g. \"=SUM(B2:B4)\". At most 5000 cells per call.",
  riskLevel: "moderate",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: PATH_HELP },
      range: { type: "string", description: "Where the top-left cell goes, in A1 notation, e.g. \"A1\" or \"B2:D4\"." },
      values: { type: "array", description: "Rows of cells, all the same length.", items: { type: "array", items: {} } },
      sheet: { type: "string", description: "Sheet name; defaults to the sheet that is showing." },
    },
    required: ["path", "range", "values"],
  },
  async execute(_ctx, params) {
    return callEditor("sheet", "write", { path: params.path, range: params.range, values: params.values, sheet: params.sheet });
  },
});

const DOC_PATH_HELP = "Path of the .docx file relative to the project root, e.g. \"notes/report.docx\".";

export const docCreateTool = defineTool({
  name: "doc_create",
  description:
    "Creates a new Word document (.docx) and opens it in the workspace beside the chat, where the user sees the text appear and can edit it by hand. " +
    "Optionally fills it with `markdown` (headings with #, **bold**, *italic*, lists, tables, links). Refuses to overwrite an existing file. " +
    "Use doc_write afterwards to keep editing the same open document.",
  riskLevel: "moderate",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: DOC_PATH_HELP },
      markdown: { type: "string", description: "Optional initial content as Markdown." },
    },
    required: ["path"],
  },
  async execute(_ctx, params) {
    return callEditor("doc", "create", { path: params.path, markdown: params.markdown });
  },
});

export const docOpenTool = defineTool({
  name: "doc_open",
  description: "Opens an existing Word document (.docx) in the workspace beside the chat and returns its block and word counts. Call this before reading or writing a file the user has not opened yet.",
  riskLevel: "safe",
  parameters: { type: "object", properties: { path: { type: "string", description: DOC_PATH_HELP } }, required: ["path"] },
  async execute(_ctx, params) {
    return callEditor("doc", "open", { path: params.path });
  },
});

export const docReadTool = defineTool({
  name: "doc_read",
  description:
    "Reads the Word document the user has open (opens it if needed). Returns `blocks` — every top-level block numbered from 0 with its type and the start of its text — and `markdown`, the whole document. " +
    "Use the block numbers with doc_write's replace_block / insert_after / delete_block. Embedded pictures show as ![alt](embedded-image).",
  riskLevel: "safe",
  parameters: { type: "object", properties: { path: { type: "string", description: DOC_PATH_HELP } }, required: ["path"] },
  async execute(_ctx, params) {
    return callEditor("doc", "read", { path: params.path });
  },
});

export const docWriteTool = defineTool({
  name: "doc_write",
  description:
    "Edits the Word document the user has open, live: the change appears on screen and is saved to the file. Content is Markdown (# headings, **bold**, *italic*, lists, tables, [links](url)). " +
    "`mode`: \"replace\" the whole document, \"append\" at the end, \"prepend\" at the start, \"insert_after\" block `index`, \"replace_block\" block `index`, or \"delete_block\" block `index` (no markdown needed). " +
    "Block numbers come from doc_read and start at 0. To change one paragraph, prefer replace_block over replacing everything.",
  riskLevel: "moderate",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: DOC_PATH_HELP },
      mode: { type: "string", enum: ["replace", "append", "prepend", "insert_after", "replace_block", "delete_block"] },
      markdown: { type: "string", description: "The content (not needed for delete_block)." },
      index: { type: "integer", description: "Block number, from doc_read (insert_after, replace_block, delete_block)." },
    },
    required: ["path", "mode"],
  },
  async execute(_ctx, params) {
    return callEditor("doc", "write", { path: params.path, mode: params.mode, markdown: params.markdown, index: params.index });
  },
});

export const docFindReplaceTool = defineTool({
  name: "doc_find_replace",
  description: "Replaces text in the Word document the user has open, live. Matches within a single formatted stretch of text. By default replaces every occurrence; set all=false for the first only. Returns how many were replaced.",
  riskLevel: "moderate",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: DOC_PATH_HELP },
      find: { type: "string" },
      replace: { type: "string", description: "Replacement text (empty deletes the match)." },
      all: { type: "boolean", description: "Replace every occurrence (default true)." },
    },
    required: ["path", "find"],
  },
  async execute(_ctx, params) {
    return callEditor("doc", "find_replace", { path: params.path, find: params.find, replace: params.replace, all: params.all });
  },
});

const DECK_PATH_HELP = "Path of the .pptx file relative to the project root, e.g. \"notes/pitch.pptx\".";
const DECK_FORMAT =
  "Content is Markdown, slides separated by a line with only ---. The first heading of a slide is its title (# for title/section slides, ## otherwise); " +
  "on a title or section slide the first paragraph is the subtitle. Directives are HTML comments: <!-- layout: title|content|section|two-column|blank -->, " +
  "<!-- col --> starts the right column of a two-column slide, <!-- notes: speaker notes -->, and <!-- theme: light|dark|accent --> at the very top. " +
  "Slide bodies take paragraphs, - bullet lists (nested by 2 spaces), 1. numbered lists, | tables |, ``` code and **bold**, *italic*, [links](url).";

export const deckCreateTool = defineTool({
  name: "deck_create",
  description:
    "Creates a new PowerPoint presentation (.pptx) and opens it in the workspace beside the chat, where the user sees the slides appear and can edit them by hand. " +
    `Optionally fills it with \`markdown\`. ${DECK_FORMAT} Refuses to overwrite an existing file. Use deck_write afterwards to keep editing the same open deck.`,
  riskLevel: "moderate",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: DECK_PATH_HELP },
      markdown: { type: "string", description: "Optional initial content: the whole deck as Markdown." },
    },
    required: ["path"],
  },
  async execute(_ctx, params) {
    return callEditor("deck", "create", { path: params.path, markdown: params.markdown });
  },
});

export const deckOpenTool = defineTool({
  name: "deck_open",
  description: "Opens an existing PowerPoint file (.pptx) in the workspace beside the chat and returns its slide count. Call this before reading or writing a deck the user has not opened yet.",
  riskLevel: "safe",
  parameters: { type: "object", properties: { path: { type: "string", description: DECK_PATH_HELP } }, required: ["path"] },
  async execute(_ctx, params) {
    return callEditor("deck", "open", { path: params.path });
  },
});

export const deckReadTool = defineTool({
  name: "deck_read",
  description:
    "Reads the presentation the user has open (opens it if needed). Returns `slides` — each numbered from 0 with its layout and title — and `markdown`, the whole deck. " +
    "Use the slide numbers with deck_write's insert_after / replace_slide / delete_slide.",
  riskLevel: "safe",
  parameters: { type: "object", properties: { path: { type: "string", description: DECK_PATH_HELP } }, required: ["path"] },
  async execute(_ctx, params) {
    return callEditor("deck", "read", { path: params.path });
  },
});

export const deckWriteTool = defineTool({
  name: "deck_write",
  description:
    "Edits the presentation the user has open, live: the change appears on screen and is saved to the file. " +
    "`mode`: \"replace\" the whole deck, \"append\" slides at the end, \"insert_after\" slide `index`, \"replace_slide\" slide `index` (markdown holds one or more slides), or \"delete_slide\" slide `index` (no markdown needed). " +
    `Slide numbers come from deck_read and start at 0. ${DECK_FORMAT}`,
  riskLevel: "moderate",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: DECK_PATH_HELP },
      mode: { type: "string", enum: ["replace", "append", "insert_after", "replace_slide", "delete_slide"] },
      markdown: { type: "string", description: "The slides (not needed for delete_slide)." },
      index: { type: "integer", description: "Slide number, from deck_read (insert_after, replace_slide, delete_slide)." },
    },
    required: ["path", "mode"],
  },
  async execute(_ctx, params) {
    return callEditor("deck", "write", { path: params.path, mode: params.mode, markdown: params.markdown, index: params.index });
  },
});

export const officeTools = [
  sheetCreateTool, sheetOpenTool, sheetReadRangeTool, sheetWriteRangeTool,
  docCreateTool, docOpenTool, docReadTool, docWriteTool, docFindReplaceTool,
  deckCreateTool, deckOpenTool, deckReadTool, deckWriteTool,
];
