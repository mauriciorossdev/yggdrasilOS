import { describe, expect, it } from "vitest";
import type { DeckModel } from "@yggdrasil/tool-office";
import { addSlideAfter, applyDeckWrite, describeSlides, duplicateSlide, moveSlide, removeSlide } from "./deckOps.js";

const deck = (): DeckModel => ({
  theme: "light",
  slides: [
    { layout: "title", title: [{ text: "One" }], body: [] },
    { layout: "content", title: [{ text: "Two" }], body: [] },
    { layout: "content", title: [{ text: "Three" }], body: [] },
  ],
});
const titles = (d: DeckModel) => d.slides.map((s) => s.title.map((r) => r.text).join(""));

describe("applyDeckWrite", () => {
  it("replaces, appends, inserts, replaces and deletes slides", () => {
    expect(titles(applyDeckWrite(deck(), { mode: "replace", markdown: "# A\n\n---\n\n## B" }))).toEqual(["A", "B"]);
    expect(titles(applyDeckWrite(deck(), { mode: "append", markdown: "## Four" }))).toEqual(["One", "Two", "Three", "Four"]);
    expect(titles(applyDeckWrite(deck(), { mode: "insert_after", index: 0, markdown: "## New" }))).toEqual(["One", "New", "Two", "Three"]);
    expect(titles(applyDeckWrite(deck(), { mode: "replace_slide", index: 1, markdown: "## X\n\n---\n\n## Y" }))).toEqual(["One", "X", "Y", "Three"]);
    expect(titles(applyDeckWrite(deck(), { mode: "delete_slide", index: 2 }))).toEqual(["One", "Two"]);
  });
  it("only infers a title slide at position 0", () => {
    expect(applyDeckWrite(deck(), { mode: "append", markdown: "# Heading only" }).slides[3]!.layout).toBe("section");
  });
  it("keeps one slide when everything is deleted or replaced by nothing", () => {
    expect(applyDeckWrite({ theme: "light", slides: [deck().slides[0]!] }, { mode: "delete_slide", index: 0 }).slides).toHaveLength(1);
    expect(applyDeckWrite(deck(), { mode: "replace", markdown: "" }).slides).toHaveLength(1);
  });
  it("rejects bad requests with a message for the model", () => {
    expect(() => applyDeckWrite(deck(), { mode: "append" })).toThrow(/markdown is required/);
    expect(() => applyDeckWrite(deck(), { mode: "delete_slide" })).toThrow(/index is required/);
    expect(() => applyDeckWrite(deck(), { mode: "delete_slide", index: 3 })).toThrow(/out of range: the deck has 3 slide/);
  });
});

describe("slide operations", () => {
  it("adds, duplicates, removes and moves", () => {
    expect(addSlideAfter(deck(), 0).slides).toHaveLength(4);
    expect(titles(duplicateSlide(deck(), 1))).toEqual(["One", "Two", "Two", "Three"]);
    expect(titles(removeSlide(deck(), 0))).toEqual(["Two", "Three"]);
    expect(titles(moveSlide(deck(), 0, 2))).toEqual(["Two", "Three", "One"]);
    expect(moveSlide(deck(), 0, 5)).toEqual(deck());
  });
  it("describes slides for the model", () => {
    expect(describeSlides(deck())[1]).toEqual({ index: 1, layout: "content", title: "Two" });
  });
});
