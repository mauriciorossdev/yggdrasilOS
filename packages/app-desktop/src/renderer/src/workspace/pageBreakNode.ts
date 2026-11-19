import { Node } from "@tiptap/core";

/** A page break, as its own block: drawn as a dashed line in the editor, saved as a Word page break. */
export const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: "div[data-page-break]" }];
  },
  renderHTML() {
    return ["div", { "data-page-break": "", class: "doc-page-break" }, "page break"];
  },
  // tiptap-markdown has no built-in rule for a custom node: written as a tiny HTML element (the Markdown
  // extension runs with html enabled) so it survives a read/write through Markdown.
  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (s: string) => void; closeBlock: (n: unknown) => void }, node: unknown) {
          state.write("<div data-page-break></div>");
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
});
