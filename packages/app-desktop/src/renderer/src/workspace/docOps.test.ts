import { describe, expect, it } from "vitest";
import { countWords, describeBlocks, findMatches, markdownForModel, MAX_MARKDOWN_CHARS, planWrite, snippet } from "./docOps.js";

describe("planWrite", () => {
  it("maps each mode to what the editor must do", () => {
    expect(planWrite({ mode: "replace", markdown: "x" }, 3)).toEqual({ kind: "set-all" });
    expect(planWrite({ mode: "append", markdown: "x" }, 3)).toEqual({ kind: "insert", at: "end" });
    expect(planWrite({ mode: "prepend", markdown: "x" }, 3)).toEqual({ kind: "insert", at: "start" });
    expect(planWrite({ mode: "insert_after", markdown: "x", index: 2 }, 3)).toEqual({ kind: "insert-after", index: 2 });
    expect(planWrite({ mode: "replace_block", markdown: "x", index: 0 }, 3)).toEqual({ kind: "replace-block", index: 0 });
    expect(planWrite({ mode: "delete_block", index: 1 }, 3)).toEqual({ kind: "delete-block", index: 1 });
  });

  it("explains a missing markdown, a missing or out-of-range index, and an oversized write", () => {
    expect(() => planWrite({ mode: "append" }, 1)).toThrow(/markdown is required/);
    expect(() => planWrite({ mode: "replace_block", markdown: "x" }, 2)).toThrow(/index is required/);
    expect(() => planWrite({ mode: "delete_block", index: 5 }, 2)).toThrow(/out of range: the document has 2 block\(s\)/);
    expect(() => planWrite({ mode: "delete_block", index: -1 }, 2)).toThrow(/out of range/);
    expect(() => planWrite({ mode: "append", markdown: "x".repeat(MAX_MARKDOWN_CHARS + 1) }, 1)).toThrow(/too long/);
  });

  it("does not ask for markdown when deleting", () => {
    expect(() => planWrite({ mode: "delete_block", index: 0 }, 1)).not.toThrow();
  });
});

describe("helpers", () => {
  it("shortens a block's text to one line", () => {
    expect(snippet("a\n  b   c")).toBe("a b c");
    expect(snippet("x".repeat(500)).length).toBe(160);
    expect(describeBlocks([{ type: "heading", text: "Title" }, { type: "paragraph", text: "Body" }])).toEqual([
      { index: 0, type: "heading", text: "Title" },
      { index: 1, type: "paragraph", text: "Body" },
    ]);
  });
  it("hides embedded picture data from the model", () => {
    expect(markdownForModel("a ![alt](data:image/png;base64,AAAA) b ![x](https://e.com/i.png)")).toBe("a ![alt](embedded-image) b ![x](https://e.com/i.png)");
  });
  it("counts words and finds matches", () => {
    expect(countWords("  one two\nthree ")).toBe(3);
    expect(countWords("   ")).toBe(0);
    expect(findMatches("aXbXc", "X", true)).toEqual([[1, 2], [3, 4]]);
    expect(findMatches("aXbXc", "X", false)).toEqual([[1, 2]]);
    expect(findMatches("aaaa", "aa", true)).toEqual([[0, 2], [2, 4]]);
    expect(() => findMatches("a", "", true)).toThrow(/must not be empty/);
  });
});
