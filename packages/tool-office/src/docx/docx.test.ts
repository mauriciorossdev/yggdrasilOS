import mammoth from "mammoth";
import { describe, expect, it } from "vitest";
import type { DocModel } from "./model.js";
import { docxToModel } from "./read.js";
import { modelToDocx } from "./write.js";

// A 1x1 transparent PNG.
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const sample: DocModel = {
  blocks: [
    { type: "heading", level: 1, runs: [{ text: "Quarterly report" }], align: "center" },
    {
      type: "paragraph",
      runs: [
        { text: "Plain, " },
        { text: "bold", bold: true },
        { text: ", " },
        { text: "italic", italic: true },
        { text: ", " },
        { text: "underlined", underline: true },
        { text: ", " },
        { text: "struck", strike: true },
        { text: ", " },
        { text: "red", color: "#FF0000" },
        { text: ", " },
        { text: "marked", highlight: "#FFFF00" },
        { text: " and a " },
        { text: "link", link: "https://example.com/docs" },
        { text: "." },
      ],
    },
    { type: "paragraph", runs: [{ text: "Right aligned" }], align: "right" },
    { type: "heading", level: 3, runs: [{ text: "Details" }] },
    {
      type: "list",
      ordered: false,
      items: [
        { runs: [{ text: "first" }], children: [{ type: "list", ordered: true, items: [{ runs: [{ text: "one" }] }, { runs: [{ text: "two" }] }] }] },
        { runs: [{ text: "second" }] },
      ],
    },
    { type: "list", ordered: true, items: [{ runs: [{ text: "step A" }] }, { runs: [{ text: "step B" }] }] },
    {
      type: "table",
      rows: [
        [{ blocks: [{ type: "paragraph", runs: [{ text: "Item", bold: true }] }], header: true }, { blocks: [{ type: "paragraph", runs: [{ text: "Qty" }] }], header: true }],
        [{ blocks: [{ type: "paragraph", runs: [{ text: "Apples" }] }] }, { blocks: [{ type: "paragraph", runs: [{ text: "3" }] }] }],
        [{ blocks: [{ type: "paragraph", runs: [{ text: "Merged across both" }] }], colSpan: 2 }],
      ],
    },
    { type: "image", data: PNG_B64, mime: "image/png", width: 120, height: 60, alt: "a pixel" },
    { type: "code", text: "const a = 1;\nconsole.log(a);" },
    { type: "pageBreak" },
    { type: "paragraph", runs: [{ text: "After the break" }] },
  ],
};

describe("modelToDocx → docxToModel", () => {
  it("round-trips every kind of block, with its formatting", async () => {
    const back = await docxToModel(await modelToDocx(sample));
    expect(back.blocks).toEqual(sample.blocks);
  });

  it("keeps an empty document readable", async () => {
    const back = await docxToModel(await modelToDocx({ blocks: [] }));
    expect(back.blocks).toEqual([{ type: "paragraph", runs: [] }]);
  });

  it("keeps line breaks and tabs inside a paragraph", async () => {
    const model: DocModel = { blocks: [{ type: "paragraph", runs: [{ text: "line one\nline two\tafter tab" }] }] };
    expect((await docxToModel(await modelToDocx(model))).blocks).toEqual(model.blocks);
  });

  it("restarts numbering for each separate ordered list", async () => {
    const buf = await modelToDocx({
      blocks: [
        { type: "list", ordered: true, items: [{ runs: [{ text: "a" }] }, { runs: [{ text: "b" }] }] },
        { type: "paragraph", runs: [{ text: "between" }] },
        { type: "list", ordered: true, items: [{ runs: [{ text: "c" }] }] },
      ],
    });
    const html = (await mammoth.convertToHtml({ buffer: buf })).value;
    expect(html.match(/<ol>/g)?.length).toBe(2);
  });
});

describe("the written .docx is a valid document for an independent reader (mammoth)", () => {
  it("shows headings, emphasis, links, lists, tables and the picture", async () => {
    const buf = await modelToDocx(sample);
    const html = (await mammoth.convertToHtml({ buffer: buf })).value;
    expect(html).toContain("<h1>Quarterly report</h1>");
    expect(html).toContain("<h3>Details</h3>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain('<a href="https://example.com/docs">link</a>');
    expect(html).toContain("<ul>");
    expect(html).toContain("<ol>");
    expect(html).toContain("<table>");
    expect(html).toContain("Apples");
    // Only the first row is a header: the body rows must not be read as one.
    expect(html).toMatch(/<th>\s*<p><strong>Item<\/strong><\/p>/);
    expect(html).toMatch(/<td>\s*<p>Apples<\/p>/);
    expect(html).toContain("<img");
    expect(html).toContain("After the break");
  });
});
