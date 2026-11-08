import { describe, expect, it } from "vitest";
import { buildBacklinks, mergeIndex, wikiItems, type NoteInfo, type NotesIndex } from "./notesIndex.js";

const note = (path: string, title: string, links: Array<[string, number]> = []): NoteInfo => ({
  path,
  title,
  links: links.map(([target, line]) => ({ target, line, text: `linea ${line} -> ${target}` })),
});
const indexOf = (...notes: NoteInfo[]): NotesIndex => new Map(notes.map((n) => [n.path, n]));

describe("mergeIndex", () => {
  const a = note("notes/a.md", "A", [["notes/b.md", 3]]);
  const b = note("notes/b.md", "B");

  it("a full answer replaces everything", () => {
    const merged = mergeIndex(indexOf(a, b), [note("notes/c.md", "C")]);
    expect([...merged.keys()]).toEqual(["notes/c.md"]);
  });

  it("a partial answer replaces only what was asked, and drops what was asked but didn't come back", () => {
    const updated = note("notes/a.md", "A nueva");
    const merged = mergeIndex(indexOf(a, b), [updated], ["notes/a.md", "notes/b.md"]);
    expect([...merged.keys()]).toEqual(["notes/a.md"]);
    expect(merged.get("notes/a.md")!.title).toBe("A nueva");
  });

  it("a partial answer leaves the rest alone and doesn't mutate the old index", () => {
    const old = indexOf(a, b);
    const merged = mergeIndex(old, [note("notes/a.md", "A2")], ["notes/a.md"]);
    expect(merged.get("notes/b.md")).toBe(b);
    expect(old.get("notes/a.md")!.title).toBe("A");
  });
});

describe("buildBacklinks", () => {
  const index = indexOf(
    note("notes/contrato.md", "Contrato"),
    note("notes/reuniones/2026-10-02.md", "Reunión", [["notes/contrato.md", 8], ["notes/otra.md", 9]]),
    note("notes/resumen.md", "Resumen", [["notes/contrato.md", 4], ["notes/contrato.md", 12]]),
    note("notes/contrato-v2.md", "Contrato v2", [["notes/contrato.md", 2]]),
  );

  it("lists every link to the note, ordered by title then line", () => {
    expect(buildBacklinks(index, "notes/contrato.md").map((b) => [b.title, b.line])).toEqual([
      ["Contrato v2", 2],
      ["Resumen", 4],
      ["Resumen", 12],
      ["Reunión", 8],
    ]);
  });

  it("carries the context line, and is empty for a note nobody links to", () => {
    expect(buildBacklinks(index, "notes/contrato.md")[3]!.text).toBe("linea 8 -> notes/contrato.md");
    expect(buildBacklinks(index, "notes/resumen.md")).toEqual([]);
  });

  it("ignores a note's links to itself", () => {
    const self = indexOf(note("notes/a.md", "A", [["notes/a.md", 1]]));
    expect(buildBacklinks(self, "notes/a.md")).toEqual([]);
  });
});

describe("wikiItems", () => {
  const index = indexOf(note("notes/b/z.md", "Zeta"), note("notes/a.md", "Alfa"), note("00.md", "Índice"));

  it("offers every note but the open one, alphabetical by title, with its folder", () => {
    expect(wikiItems(index, "notes/a.md")).toEqual([
      { path: "00.md", title: "Índice", folder: "" },
      { path: "notes/b/z.md", title: "Zeta", folder: "notes/b" },
    ]);
  });

  it("includes all of them when no note is excluded", () => {
    expect(wikiItems(index).map((i) => i.title)).toEqual(["Alfa", "Índice", "Zeta"]);
  });
});
