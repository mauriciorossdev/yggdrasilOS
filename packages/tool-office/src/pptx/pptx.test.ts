import { OfficeParser } from "officeparser";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { parseDeckMarkdown } from "./deckMarkdown.js";
import { inspectPptxLossy, FOREIGN_DECK } from "./inspect.js";
import type { DeckModel } from "./model.js";
import { pptxToDeck } from "./read.js";
import { deckToPptx } from "./write.js";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const deck: DeckModel = {
  theme: "dark",
  slides: [
    { layout: "title", title: [{ text: "Quarterly review" }], subtitle: [{ text: "Prepared by " }, { text: "Sales", bold: true }], body: [] },
    {
      layout: "content",
      title: [{ text: "Highlights" }],
      body: [
        { type: "paragraph", runs: [{ text: "Plain " }, { text: "bold", bold: true }, { text: " " }, { text: "it", italic: true }, { text: " " }, { text: "red", color: "#FF0000" }, { text: " " }, { text: "link", link: "https://example.com" }] },
        { type: "list", ordered: false, items: [{ runs: [{ text: "Revenue up" }], children: [{ type: "list", ordered: false, items: [{ runs: [{ text: "in Europe" }] }] }] }, { runs: [{ text: "Costs down" }] }] },
        { type: "list", ordered: true, items: [{ runs: [{ text: "first" }] }, { runs: [{ text: "second" }] }] },
        { type: "heading", level: 3, runs: [{ text: "Sub heading" }] },
        { type: "table", rows: [[{ blocks: [{ type: "paragraph", runs: [{ text: "Month" }] }], header: true }, { blocks: [{ type: "paragraph", runs: [{ text: "Sales" }] }], header: true }], [{ blocks: [{ type: "paragraph", runs: [{ text: "Jan" }] }] }, { blocks: [{ type: "paragraph", runs: [{ text: "10" }] }] }]] },
        { type: "code", text: "a = 1\nb = 2" },
      ],
      notes: "Mention the Europe launch first",
    },
    {
      layout: "two-column",
      title: [{ text: "Compare" }],
      body: [{ type: "paragraph", runs: [{ text: "Left side" }] }],
      body2: [{ type: "image", data: PNG, mime: "image/png", width: 96, height: 48, alt: "a pixel" }],
    },
    { layout: "section", title: [{ text: "Next steps" }], subtitle: [{ text: "Q1 plan" }], body: [] },
    { layout: "blank", title: [], body: [{ type: "paragraph", runs: [{ text: "Just text" }] }] },
  ],
};

describe("deckToPptx → pptxToDeck", () => {
  it("round-trips every layout, mark and block exactly", async () => {
    const back = await pptxToDeck(await deckToPptx(deck));
    expect(back.ours).toBe(true);
    expect(back.deck).toEqual(deck);
  });

  it("round-trips a deck made from Markdown", async () => {
    const parsed = parseDeckMarkdown("<!-- theme: accent -->\n\n# Hi\n\nSub\n\n---\n\n## Body\n\n- a\n- b\n\n<!-- notes: n -->");
    expect((await pptxToDeck(await deckToPptx(parsed))).deck).toEqual(parsed);
  });

  it("writes an empty deck as one blank slide", async () => {
    const back = await pptxToDeck(await deckToPptx({ theme: "light", slides: [] }));
    expect(back.deck.slides).toEqual([{ layout: "blank", title: [], body: [] }]);
  });
});

describe("the written .pptx is a valid presentation for an independent reader (officeparser)", () => {
  it("finds the text of every slide, and the notes", async () => {
    const ast = await OfficeParser.parseOffice(Buffer.from(await deckToPptx(deck)));
    const collect = (n: unknown): string[] => (Array.isArray(n) ? n.flatMap(collect) : n && typeof n === "object" ? [typeof (n as { text?: unknown }).text === "string" ? (n as { text: string }).text : "", ...collect((n as { children?: unknown }).children)] : []);
    const text = collect(ast.content).join("\n");
    expect(ast.content.length).toBe(deck.slides.length);
    for (const expected of ["Quarterly review", "Sales", "Highlights", "Revenue up", "in Europe", "Costs down", "Sub heading", "Month", "Jan", "Compare", "Left side", "Next steps", "Just text"]) {
      expect(text).toContain(expected);
    }
  });
});

describe("inspectPptxLossy", () => {
  it("reports nothing for a deck this app wrote", async () => {
    expect(await inspectPptxLossy(await deckToPptx(deck))).toEqual([]);
  });

  it("calls a deck from another app by what the model loses: its design", async () => {
    const zip = await JSZip.loadAsync(await deckToPptx(deck));
    const core = await zip.file("docProps/core.xml")!.async("string");
    zip.file("docProps/core.xml", core.replace(/Yggdrasil/g, "Somebody Else"));
    expect(await inspectPptxLossy(await zip.generateAsync({ type: "uint8array" }))).toContain(FOREIGN_DECK);
  });

  it("calls our deck foreign once another app has saved it", async () => {
    const zip = await JSZip.loadAsync(await deckToPptx(deck));
    const core = await zip.file("docProps/core.xml")!.async("string");
    zip.file("docProps/core.xml", core.replace(/<cp:lastModifiedBy>[^<]*<\/cp:lastModifiedBy>/, "<cp:lastModifiedBy>PowerPoint User</cp:lastModifiedBy>"));
    expect(await inspectPptxLossy(await zip.generateAsync({ type: "uint8array" }))).toContain(FOREIGN_DECK);
  });

  it("names charts, animations, transitions, SmartArt, media and comments", async () => {
    const zip = await JSZip.loadAsync(await deckToPptx(deck));
    zip.file("ppt/charts/chart1.xml", "<c:chartSpace/>");
    zip.file("ppt/diagrams/data1.xml", "<dgm/>");
    zip.file("ppt/comments/comment1.xml", "<comments/>");
    zip.file("ppt/media/clip.mp4", "x");
    const slide = await zip.file("ppt/slides/slide1.xml")!.async("string");
    zip.file("ppt/slides/slide1.xml", slide.replace("</p:sld>", "<p:transition/><p:timing/></p:sld>"));
    expect((await inspectPptxLossy(await zip.generateAsync({ type: "uint8array" }))).sort()).toEqual(
      ["SmartArt", "animations", "audio or video", "charts", "comments", "transitions"].sort(),
    );
  });
});
