import { describe, expect, it } from "vitest";
import { highlightQuery, splitAt } from "./highlight.js";

describe("splitAt", () => {
  it("splits around the range", () => {
    expect(splitAt("contrato de flujos", 12, 18)).toEqual([
      { text: "contrato de ", match: false },
      { text: "flujos", match: true },
    ]);
    expect(splitAt("hola mundo", 0, 4)).toEqual([
      { text: "hola", match: true },
      { text: " mundo", match: false },
    ]);
  });

  it("leaves the text whole for an empty or out-of-range range", () => {
    expect(splitAt("hola", 2, 2)).toEqual([{ text: "hola", match: false }]);
    expect(splitAt("hola", 9, 12)).toEqual([{ text: "hola", match: false }]);
    expect(splitAt("hola", 2, 99)).toEqual([
      { text: "ho", match: false },
      { text: "la", match: true },
    ]);
  });
});

describe("highlightQuery", () => {
  it("marks every occurrence, case-insensitively, keeping the original casing", () => {
    expect(highlightQuery("Flujos y flujos", "FLUJOS")).toEqual([
      { text: "Flujos", match: true },
      { text: " y ", match: false },
      { text: "flujos", match: true },
    ]);
  });

  it("returns the text whole when there is nothing to mark", () => {
    expect(highlightQuery("hola", "")).toEqual([{ text: "hola", match: false }]);
    expect(highlightQuery("hola", "xyz")).toEqual([{ text: "hola", match: false }]);
  });
});
