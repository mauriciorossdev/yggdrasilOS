import { describe, expect, it } from "vitest";
import { deckToMarkdown, parseDeckMarkdown, slideToMarkdown } from "./deckMarkdown.js";
import type { DeckModel } from "./model.js";

const md = [
  "<!-- theme: dark -->",
  "",
  "# Quarterly review",
  "",
  "Prepared by **Sales**",
  "",
  "---",
  "",
  "## Highlights",
  "",
  "- Revenue up",
  "  - in Europe",
  "- Costs down",
  "",
  "<!-- notes: Mention the Europe launch first -->",
  "",
  "---",
  "",
  "<!-- layout: two-column -->",
  "",
  "## Compare",
  "",
  "Left side text",
  "",
  "<!-- col -->",
  "",
  "| A | B |",
  "| --- | --- |",
  "| 1 | 2 |",
  "",
  "---",
  "",
  "<!-- layout: section -->",
  "",
  "# Next steps",
].join("\n");

describe("parseDeckMarkdown", () => {
  const deck = parseDeckMarkdown(md);

  it("reads the theme and splits slides on ---", () => {
    expect(deck.theme).toBe("dark");
    expect(deck.slides.map((s) => s.layout)).toEqual(["title", "content", "two-column", "section"]);
  });

  it("puts the heading in the title and the first paragraph of a title slide in the subtitle", () => {
    expect(deck.slides[0]!.title).toEqual([{ text: "Quarterly review" }]);
    expect(deck.slides[0]!.subtitle).toEqual([{ text: "Prepared by " }, { text: "Sales", bold: true }]);
    expect(deck.slides[0]!.body).toEqual([]);
  });

  it("reads lists, notes, columns and tables", () => {
    expect(deck.slides[1]!.body[0]).toMatchObject({ type: "list", ordered: false });
    expect(deck.slides[1]!.notes).toBe("Mention the Europe launch first");
    expect(deck.slides[2]!.body).toEqual([{ type: "paragraph", runs: [{ text: "Left side text" }] }]);
    expect(deck.slides[2]!.body2![0]!.type).toBe("table");
  });

  it("round-trips through deckToMarkdown", () => {
    expect(parseDeckMarkdown(deckToMarkdown(deck))).toEqual(deck);
  });
});

describe("edge cases", () => {
  it("does not split on a --- inside a code fence", () => {
    const d = parseDeckMarkdown("## A\n\n```\n---\n```\n\n---\n\n## B");
    expect(d.slides).toHaveLength(2);
    expect(d.slides[0]!.body[0]).toEqual({ type: "code", text: "---" });
  });
  it("ignores a leading separator and unknown directives", () => {
    const d = parseDeckMarkdown("---\n\n<!-- layout: nonsense -->\n## Only\n\n- a");
    expect(d.slides).toHaveLength(1);
    expect(d.slides[0]!.layout).toBe("content");
  });
  it("a bare heading on a later slide is a section", () => {
    expect(parseDeckMarkdown("# One\n\n---\n\n# Two").slides[1]!.layout).toBe("section");
  });
  it("an empty document has no slides", () => {
    expect(parseDeckMarkdown("")).toEqual({ theme: "light", slides: [] });
  });
  it("serializes one slide on its own", () => {
    const deck: DeckModel = parseDeckMarkdown("## Hello\n\n- a");
    expect(slideToMarkdown(deck.slides[0]!, 1)).toBe("## Hello\n\n- a");
  });
});

describe("deck_read output round-trips through deck_write", () => {
  const rt = (deck: DeckModel) => parseDeckMarkdown(deckToMarkdown(deck));
  const t = (text: string) => [{ text }];
  const p = (text: string) => ({ type: "paragraph" as const, runs: t(text) });
  it("keeps a content slide with a title and an empty body", () => {
    const deck: DeckModel = { theme: "light", slides: [{ layout: "title", title: t("Hi"), body: [] }, { layout: "content", title: t("Empty"), body: [] }] };
    expect(rt(deck).slides.map((s) => s.layout)).toEqual(["title", "content"]);
  });
  it("keeps a content slide 0 with one paragraph, and a section with a subtitle", () => {
    const deck: DeckModel = {
      theme: "light",
      slides: [
        { layout: "content", title: t("A"), body: [p("only")] },
        { layout: "section", title: t("S"), subtitle: t("sub"), body: [] },
        { layout: "title", title: t("T"), subtitle: t("sub"), body: [] },
      ],
    };
    const back = rt(deck);
    expect(back.slides.map((s) => s.layout)).toEqual(["content", "section", "title"]);
    expect(back.slides[0]!.body).toEqual([p("only")]);
    expect(back.slides[2]!.subtitle).toEqual(t("sub"));
  });
});

