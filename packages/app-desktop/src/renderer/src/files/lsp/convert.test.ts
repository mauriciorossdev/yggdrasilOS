import { describe, expect, it } from "vitest";
import { applyTextEdits, completionKindName, diagnosticKey, lspLanguageId, relativeIfInside, symbolKindName, toLspRange, toMarker, toMonacoRange } from "./convert.js";

const range = (sl: number, sc: number, el: number, ec: number) => ({ start: { line: sl, character: sc }, end: { line: el, character: ec } });

describe("lsp convert", () => {
  it("converts ranges between 0-based and 1-based", () => {
    const monaco = toMonacoRange(range(0, 2, 3, 4));
    expect(monaco).toEqual({ startLineNumber: 1, startColumn: 3, endLineNumber: 4, endColumn: 5 });
    expect(toLspRange(monaco)).toEqual(range(0, 2, 3, 4));
  });

  it("names kinds across the two numberings", () => {
    expect(completionKindName(2)).toBe("Method");
    expect(completionKindName(25)).toBe("TypeParameter");
    expect(completionKindName(undefined)).toBe("Text");
    expect(symbolKindName(12)).toBe("Function");
  });

  it("makes markers from diagnostics, an error by default", () => {
    expect(toMarker({ range: range(1, 0, 1, 3), message: "bad", code: 2304, source: "ts", severity: 2 })).toMatchObject({
      startLineNumber: 2,
      severity: 4,
      message: "bad",
      code: "2304",
      source: "ts",
    });
    expect(toMarker({ range: range(0, 0, 0, 1), message: "x" }).severity).toBe(8);
  });

  it("finds a diagnostic again from its marker", () => {
    const marker = toMarker({ range: range(1, 0, 1, 3), message: "bad" });
    expect(diagnosticKey(marker, marker.message)).toBe(diagnosticKey(toMonacoRange(range(1, 0, 1, 3)), "bad"));
  });

  it("applies edits against the original text, in any order", () => {
    const text = "one\ntwo\nthree\n";
    expect(
      applyTextEdits(text, [
        { range: range(2, 0, 2, 5), newText: "3" },
        { range: range(0, 0, 0, 3), newText: "1" },
        { range: range(1, 3, 1, 3), newText: "!" },
      ]),
    ).toBe("1\ntwo!\n3\n");
  });

  it("keeps the order of inserts at one place, and clamps past-the-end positions", () => {
    expect(applyTextEdits("ab", [{ range: range(0, 1, 0, 1), newText: "x" }, { range: range(0, 1, 0, 1), newText: "y" }])).toBe("axyb");
    expect(applyTextEdits("ab", [{ range: range(9, 0, 9, 0), newText: "!" }])).toBe("ab!");
    expect(applyTextEdits("ab\ncd", [{ range: range(0, 99, 0, 99), newText: "!" }])).toBe("ab!\ncd");
  });

  it("refuses overlapping edits rather than corrupting a file", () => {
    expect(() => applyTextEdits("abcd", [{ range: range(0, 0, 0, 3), newText: "" }, { range: range(0, 1, 0, 2), newText: "" }])).toThrow(/overlapping/);
  });

  it("works out project-relative paths", () => {
    expect(relativeIfInside("/home/me/app/src/a.ts", "/home/me/app")).toBe("src/a.ts");
    expect(relativeIfInside("/home/me/app2/a.ts", "/home/me/app")).toBeNull();
    expect(relativeIfInside("/home/me/App/a.ts", "/home/me/app")).toBeNull();
    expect(relativeIfInside("d:\\proj\\src\\a.ts", "D:\\proj")).toBe("src/a.ts");
    expect(relativeIfInside("D:/proj", "D:/proj")).toBeNull();
  });

  it("tells JSX files apart for servers", () => {
    expect(lspLanguageId("a.tsx", "typescript")).toBe("typescriptreact");
    expect(lspLanguageId("a.jsx", "javascript")).toBe("javascriptreact");
    expect(lspLanguageId("a.ts", "typescript")).toBe("typescript");
    expect(lspLanguageId("a.py", "python")).toBe("python");
  });
});
