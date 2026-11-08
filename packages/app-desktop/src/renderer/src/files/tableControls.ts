import type { Editor } from "@tiptap/react";
import type { MessageKey } from "../i18n/index.js";

/** One button of the table bar: what it does, whether it can right now (the cursor must be in a cell, a row must be deletable...). */
export type TableAction = {
  id: string;
  /** Message keys, translated where the button is drawn. */
  label: MessageKey;
  title: MessageKey;
  run: (editor: Editor) => void;
  can: (editor: Editor) => boolean;
};

export const TABLE_ACTIONS: TableAction[] = [
  { id: "rowBefore", label: "doc.table.rowBefore", title: "doc.table.rowBefore.title", run: (e) => e.chain().focus().addRowBefore().run(), can: (e) => e.can().addRowBefore() },
  { id: "rowAfter", label: "doc.table.rowAfter", title: "doc.table.rowAfter.title", run: (e) => e.chain().focus().addRowAfter().run(), can: (e) => e.can().addRowAfter() },
  { id: "colBefore", label: "doc.table.colBefore", title: "doc.table.colBefore.title", run: (e) => e.chain().focus().addColumnBefore().run(), can: (e) => e.can().addColumnBefore() },
  { id: "colAfter", label: "doc.table.colAfter", title: "doc.table.colAfter.title", run: (e) => e.chain().focus().addColumnAfter().run(), can: (e) => e.can().addColumnAfter() },
  { id: "deleteRow", label: "doc.table.deleteRow", title: "doc.table.deleteRow.title", run: (e) => e.chain().focus().deleteRow().run(), can: (e) => e.can().deleteRow() },
  { id: "deleteCol", label: "doc.table.deleteCol", title: "doc.table.deleteCol.title", run: (e) => e.chain().focus().deleteColumn().run(), can: (e) => e.can().deleteColumn() },
  { id: "header", label: "doc.table.header", title: "doc.table.header.title", run: (e) => e.chain().focus().toggleHeaderRow().run(), can: (e) => e.can().toggleHeaderRow() },
  { id: "deleteTable", label: "doc.table.deleteTable", title: "doc.table.deleteTable.title", run: (e) => e.chain().focus().deleteTable().run(), can: (e) => e.can().deleteTable() },
];

/** A 3×3 table with a header row (markdown tables need one). */
export function insertTable(editor: Editor): void {
  editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
}

/** The same table written as markdown, for the source view; `column(n)` names the header cells. */
export function tableMarkdown(column: (n: number) => string): string {
  return `

| ${column(1)} | ${column(2)} | ${column(3)} |
| --- | --- | --- |
|  |  |  |

`;
}

export const TABLE_MARKDOWN = tableMarkdown((n) => `Column ${n}`);
