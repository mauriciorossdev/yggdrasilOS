import { describe, expect, it } from "vitest";
import type { Block } from "./docx/model.js";
import { blocksToMarkdown, parseBlocks, parseInline, runsToMarkdown } from "./markdown.js";

describe("parseInline", () => {
  it("reads emphasis, strike, underline, code and links", () => {
    expect(parseInline("a **b** *c* ~~d~~ <u>e</u> `f` [g](https://x.y)")).toEqual([
      { text: "a " },
      { text: "b", bold: true },
      { text: " " },
      { text: "c", italic: true },
      { text: " " },
      { text: "d", strike: true },
      { text: " " },
      { text: "e", underline: true },
      { text: " " },
      { text: "f", code: true },
      { text: " " },
      { text: "g", link: "https://x.y" },
    ]);
  });
  it("nests emphasis and honours escapes", () => {
    expect(parseInline("***both*** \\*not italic\\*")).toEqual([{ text: "both", bold: true, italic: true }, { text: " *not italic*" }]);
  });
  it("keeps snake_case words intact", () => {
    expect(parseInline("a snake_case_name here")).toEqual([{ text: "a snake_case_name here" }]);
  });
  it("round-trips through runsToMarkdown", () => {
    const md = "x **bold** and *it* with ~~gone~~ and [site](https://e.com)";
    expect(runsToMarkdown(parseInline(md))).toBe(md);
  });
});

describe("parseBlocks / blocksToMarkdown", () => {
  const md = [
    "# Heading",
    "",
    "A paragraph with **bold**.",
    "",
    "- one",
    "  - nested",
    "- two",
    "",
    "1. first",
    "2. second",
    "",
    "| A | B |",
    "| --- | --- |",
    "| 1 | 2 |",
    "",
    "```",
    "code line",
    "```",
  ].join("\n");

  it("parses every kind of block", () => {
    const blocks = parseBlocks(md);
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "list", "list", "table", "code"]);
    const bullets = blocks[2] as Extract<Block, { type: "list" }>;
    expect(bullets.ordered).toBe(false);
    expect(bullets.items[0]!.children![0]!.items[0]!.runs).toEqual([{ text: "nested" }]);
    expect((blocks[3] as Extract<Block, { type: "list" }>).ordered).toBe(true);
    const table = blocks[4] as Extract<Block, { type: "table" }>;
    expect(table.rows[0]![0]).toMatchObject({ header: true });
    expect(table.rows[1]![1]!.blocks[0]).toEqual({ type: "paragraph", runs: [{ text: "2" }] });
    expect(blocks[5]).toEqual({ type: "code", text: "code line" });
  });

  it("starts a new list when bullets turn into numbers at the same level", () => {
    const blocks = parseBlocks("- a\n- b\n1. c\n2. d");
    expect(blocks.map((b) => (b.type === "list" ? b.ordered : b.type))).toEqual([false, true]);
  });

  it("round-trips back to the same Markdown", () => {
    expect(blocksToMarkdown(parseBlocks(md))).toBe(md);
  });

  it("joins soft-wrapped lines and keeps a double-space hard break", () => {
    expect(parseBlocks("one\ntwo")).toEqual([{ type: "paragraph", runs: [{ text: "one two" }] }]);
    expect(parseBlocks("one  \ntwo")).toEqual([{ type: "paragraph", runs: [{ text: "one\ntwo" }] }]);
  });

  it("returns nothing for blank input", () => {
    expect(parseBlocks("  \n\n")).toEqual([]);
  });
});

describe("inline round trip of awkward text", () => {
  const roundTrip = (runs: Array<{ text: string } & Record<string, unknown>>) => parseInline(runsToMarkdown(runs as never));
  it.each([
    [[{ text: "literal <u>tag</u> text" }]],
    [[{ text: "foo_ bar * baz ~ [x]" }]],
    [[{ text: "a `tick` b" }]],
    [[{ text: "snake_case * star <u>", code: true }]],
    [[{ text: "back`tick and \\ slash", code: true }]],
    [[{ text: "see", link: "https://x.y/a_(b)" }]],
  ])("keeps %j", (runs) => {
    const back = roundTrip(runs);
    expect(back.map((r) => r.text).join("")).toBe(runs.map((r) => r.text).join(""));
    expect(back.some((r) => r.underline || r.italic || r.bold || r.strike)).toBe(false);
  });
  it("keeps a code run as code and a link with ) as a link", () => {
    expect(roundTrip([{ text: "a*b", code: true }])).toEqual([{ text: "a*b", code: true }]);
    const [link] = roundTrip([{ text: "x", link: "https://x.y/a(b)" }]);
    expect(link!.text).toBe("x");
    expect(link!.link).toBe("https://x.y/a(b%29");
  });
});
