import type { DocModel } from "@yggdrasil/tool-office";
import { describe, expect, it } from "vitest";
import { docToModel, modelToDoc } from "./docConvert.js";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const model: DocModel = {
  blocks: [
    { type: "heading", level: 2, runs: [{ text: "Plan" }], align: "center" },
    {
      type: "paragraph",
      runs: [
        { text: "a " },
        { text: "bold", bold: true },
        { text: " " },
        { text: "all", bold: true, italic: true, underline: true, strike: true },
        { text: " " },
        { text: "red", color: "#FF0000" },
        { text: " " },
        { text: "marked", highlight: "#FFFF00" },
        { text: " x" },
        { text: "2", superscript: true },
        { text: " H" },
        { text: "2", subscript: true },
        { text: " " },
        { text: "link", link: "https://example.com" },
        { text: " " },
        { text: "code", code: true },
      ],
    },
    { type: "paragraph", runs: [{ text: "line one\nline two" }], align: "justify" },
    { type: "list", ordered: false, items: [{ runs: [{ text: "x" }], children: [{ type: "list", ordered: true, items: [{ runs: [{ text: "y" }] }] }] }, { runs: [{ text: "z" }] }] },
    {
      type: "table",
      rows: [
        [{ blocks: [{ type: "paragraph", runs: [{ text: "H" }] }], header: true }, { blocks: [{ type: "paragraph", runs: [{ text: "G" }] }], header: true }],
        [{ blocks: [{ type: "paragraph", runs: [{ text: "wide" }] }], colSpan: 2 }],
      ],
    },
    { type: "image", data: PNG, mime: "image/png", width: 40, height: 20, alt: "px" },
    { type: "code", text: "a = 1\nb = 2" },
    { type: "pageBreak" },
    { type: "paragraph", runs: [] },
  ],
};

describe("model ⇄ editor document", () => {
  it("round-trips every kind of block and mark", () => {
    expect(docToModel(modelToDoc(model))).toEqual(model);
  });

  it("builds a valid empty document from an empty model", () => {
    expect(modelToDoc({ blocks: [] })).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
    expect(docToModel({ type: "doc", content: [] })).toEqual({ blocks: [{ type: "paragraph", runs: [] }] });
  });

  it("maps a line break to a hard break node and back", () => {
    const doc = modelToDoc({ blocks: [{ type: "paragraph", runs: [{ text: "a\nb" }] }] });
    expect(doc.content![0]!.content!.map((n) => n.type)).toEqual(["text", "hardBreak", "text"]);
  });

  it("drops a picture that isn't embedded, and flattens a quote and a rule", () => {
    const out = docToModel({
      type: "doc",
      content: [
        { type: "image", attrs: { src: "https://example.com/x.png" } },
        { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "quoted" }] }] },
        { type: "horizontalRule" },
      ],
    });
    expect(out.blocks).toEqual([
      { type: "paragraph", runs: [{ text: "quoted" }] },
      { type: "paragraph", runs: [{ text: "———" }] },
    ]);
  });

  it("does not keep left alignment (it is the default)", () => {
    const out = docToModel({ type: "doc", content: [{ type: "paragraph", attrs: { textAlign: "left" }, content: [{ type: "text", text: "x" }] }] });
    expect(out.blocks[0]).toEqual({ type: "paragraph", runs: [{ text: "x" }] });
  });
});
