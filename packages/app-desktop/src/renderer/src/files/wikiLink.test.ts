import { describe, expect, it } from "vitest";
import { detectWikiTrigger, filterWikiItems, fold, noteHref } from "./wikiLink.js";

describe("detectWikiTrigger", () => {
  it("sees an open [[ at the end of the text, with what follows it", () => {
    expect(detectWikiTrigger("Ver [[")).toEqual({ start: 4, query: "" });
    expect(detectWikiTrigger("Ver [[contr")).toEqual({ start: 4, query: "contr" });
    expect(detectWikiTrigger("[[con trato de flujos")).toEqual({ start: 0, query: "con trato de flujos" });
  });

  it("ignores a closed link, a lone [, a broken one and a very long query", () => {
    expect(detectWikiTrigger("Ver [[contrato]]")).toBeNull();
    expect(detectWikiTrigger("Ver [contr")).toBeNull();
    expect(detectWikiTrigger("Ver [[a]] y [")).toBeNull();
    expect(detectWikiTrigger("Ver [[uno [dos")).toBeNull();
    expect(detectWikiTrigger(`[[${"x".repeat(80)}`)).toBeNull();
  });

  it("only the trigger closest to the cursor counts", () => {
    expect(detectWikiTrigger("[[uno]] y luego [[dos")).toEqual({ start: 16, query: "dos" });
  });
});

describe("fold", () => {
  it("drops case and accents", () => {
    expect(fold("Índice Maestro Ñandú")).toBe("indice maestro nandu");
  });
});

describe("filterWikiItems", () => {
  const items = [
    { path: "notes/Arquitectura/contrato-flujos.md", title: "Contrato de flujos", folder: "notes/Arquitectura" },
    { path: "notes/resumen.md", title: "Resumen general", folder: "notes" },
    { path: "notes/00-LEEME.md", title: "Índice maestro", folder: "notes" },
    { path: "notes/reuniones/flujos-2026.md", title: "Reunión", folder: "notes/reuniones" },
    { path: "notes/x.md", title: "Los flujos", folder: "notes" },
  ];

  it("with nothing typed offers the first ones", () => {
    expect(filterWikiItems(items, "", 2).map((i) => i.title)).toEqual(["Contrato de flujos", "Resumen general"]);
  });

  it("ranks a title that starts with the text, then a word that does, then a substring, then the path", () => {
    expect(filterWikiItems(items, "flujos").map((i) => i.title)).toEqual(["Contrato de flujos", "Los flujos", "Reunión"]);
    expect(filterWikiItems(items, "contr").map((i) => i.title)).toEqual(["Contrato de flujos"]);
  });

  it("ignores accents and case, and gives nothing when nothing matches", () => {
    expect(filterWikiItems(items, "INDICE").map((i) => i.title)).toEqual(["Índice maestro"]);
    expect(filterWikiItems(items, "zzzz")).toEqual([]);
  });

  it("caps the list", () => {
    expect(filterWikiItems(items, "o", 3)).toHaveLength(3);
  });
});

describe("noteHref", () => {
  it("is relative to the note's folder", () => {
    expect(noteHref("notes/a/n.md", "notes/a/otra.md")).toBe("otra.md");
    expect(noteHref("notes/a/n.md", "notes/b/otra.md")).toBe("../b/otra.md");
  });

  it("encodes spaces and parentheses so the link still parses", () => {
    expect(noteHref("notes/n.md", "notes/Mi nota (1).md")).toBe("Mi%20nota%20%281%29.md");
  });
});
