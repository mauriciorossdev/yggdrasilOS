import { describe, expect, it } from "vitest";
import { pathTokensAt, splitLocator, type Row } from "./pathLinkText.js";

const rows = (...lines: string[]): Row[] => lines.map((text) => ({ text, cols: [...text].map((_, i) => i) }));
const texts = (rowsIn: Row[], focus: number) => pathTokensAt(rowsIn, focus).map((alts) => alts.map((a) => a.text));

describe("splitLocator", () => {
  it("splits :line and :line:col", () => {
    expect(splitLocator("src/a.ts:42")).toEqual({ path: "src/a.ts", line: 42 });
    expect(splitLocator("src/a.ts:42:7")).toEqual({ path: "src/a.ts", line: 42 });
    expect(splitLocator("src/a.ts")).toEqual({ path: "src/a.ts" });
  });
});

describe("pathTokensAt", () => {
  it("finds plain paths on one row and trims sentence punctuation", () => {
    expect(texts(rows("see src/app/App.tsx, and ~/Desktop/x."), 0)).toEqual([["src/app/App.tsx"], ["~/Desktop/x"]]);
  });

  it("finds absolute and relative forms with a locator", () => {
    expect(texts(rows("at /Users/me/proj/a.ts:12:3 and ../up/b.md"), 0)).toEqual([
      ["/Users/me/proj/a.ts:12:3"],
      ["../up/b.md"],
    ]);
  });

  it("matches a single-segment home path", () => {
    expect(texts(rows("Home: ~/Desktop and ~/"), 0)).toEqual([["~/Desktop"]]);
  });

  it("does not take the tail of a URL", () => {
    expect(texts(rows("open https://github.com/org/repo/pull/1 now"), 0)).toEqual([]);
  });

  it("offers the joined path first when a TUI hard-wrapped it with indentation", () => {
    const r = rows("  ⏺ Edited packages/app-desktop/src/rend", "    erer/src/App.tsx with the fix");
    const expected = [["packages/app-desktop/src/renderer/src/App.tsx", "packages/app-desktop/src/rend"]];
    expect(texts(r, 0)).toEqual(expected);
    // Same choice from the continuation row, falling back to its own fragment.
    expect(texts(r, 1)).toEqual([["packages/app-desktop/src/renderer/src/App.tsx", "erer/src/App.tsx"]]);
  });

  it("maps a joined token to one span per row", () => {
    const r = rows("x packages/a", "  b/c.ts done");
    const [alts] = pathTokensAt(r, 0);
    expect(alts![0]).toEqual({
      text: "packages/ab/c.ts",
      spans: [
        { row: 0, start: 2, end: 12 },
        { row: 1, start: 2, end: 8 },
      ],
    });
  });

  it("joins a path split over three rows", () => {
    const r = rows("see /Users/me/very/long", "  /path/that/keeps", "  /going/file.ts end");
    expect(texts(r, 1)[0]![0]).toBe("/Users/me/very/long/path/that/keeps/going/file.ts");
  });

  it("joins xterm soft-wrapped rows (no indentation)", () => {
    const r = rows("src/components/Upd", "ateBanner.tsx");
    expect(texts(r, 0)[0]).toEqual(["src/components/UpdateBanner.tsx", "src/components/Upd"]);
  });

  it("keeps the unjoined path as an alternative when the next row is just a word", () => {
    const r = rows("edited src/App.tsx", "  and more");
    expect(texts(r, 0)).toEqual([["src/App.tsxand", "src/App.tsx"]]);
  });

  it("leaves rows with no path alone", () => {
    expect(texts(rows("hello world", "  nothing here"), 0)).toEqual([]);
  });
});
