import { beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractLinks, indexNotes, noteTitle, resolveNoteLink } from "./documents-index.js";

describe("resolveNoteLink", () => {
  it("resolves against the note's folder, with .. and a leading slash", () => {
    expect(resolveNoteLink("notes/a/n.md", "otra.md")).toBe("notes/a/otra.md");
    expect(resolveNoteLink("notes/a/n.md", "./otra.md")).toBe("notes/a/otra.md");
    expect(resolveNoteLink("notes/a/n.md", "../b/otra.md")).toBe("notes/b/otra.md");
    expect(resolveNoteLink("notes/a/n.md", "/docs/otra.md")).toBe("docs/otra.md");
  });

  it("drops anchors and queries, and decodes percent-encoding", () => {
    expect(resolveNoteLink("notes/n.md", "otra.md#seccion")).toBe("notes/otra.md");
    expect(resolveNoteLink("notes/n.md", "otra.md?x=1")).toBe("notes/otra.md");
    expect(resolveNoteLink("notes/n.md", "mi%20nota.md")).toBe("notes/mi nota.md");
  });

  it("is null for external addresses, bare anchors and paths that leave the project", () => {
    expect(resolveNoteLink("notes/n.md", "https://x.y/a.md")).toBeNull();
    expect(resolveNoteLink("notes/n.md", "mailto:a@b.c")).toBeNull();
    expect(resolveNoteLink("notes/n.md", "#seccion")).toBeNull();
    expect(resolveNoteLink("n.md", "../a.md")).toBeNull();
    expect(resolveNoteLink("notes/n.md", "")).toBeNull();
  });
});

describe("noteTitle", () => {
  it("is the first level-1 heading, past front matter, without inline marks", () => {
    expect(noteTitle("---\ntitulo: X\n---\n\n# **Índice** maestro\n\ntexto", "notes/00.md")).toBe("Índice maestro");
  });

  it("ignores a heading inside a code fence and falls back to the file name", () => {
    expect(noteTitle("```\n# no\n```\nsolo texto", "notes/Arquitectura/contrato-flujos.md")).toBe("contrato-flujos");
    expect(noteTitle("", "x.markdown")).toBe("x");
  });

  it("only a level-1 heading counts", () => {
    expect(noteTitle("## segundo\n", "notes/a.md")).toBe("a");
  });
});

describe("extractLinks", () => {
  const md = [
    "---",
    "ref: [no](skip.md)",
    "---",
    "Ver [contrato](../Arquitectura/contrato.md) y [web](https://x.y/a.md).",
    "Una imagen ![fig](a.md) no cuenta. Y [ancla](#x) tampoco.",
    "```",
    "[dentro](de-codigo.md)",
    "```",
    "Otra vez [el mismo](../Arquitectura/contrato.md) y [otro](otro.md#parte) [dup](otro.md).",
    "Un [pdf](doc.pdf) y [a sí misma](esta.md).",
  ].join("\n");

  it("lists links to other notes with their line and context, skipping front matter, code, images and externals", () => {
    const links = extractLinks(md, "notes/reuniones/esta.md");
    expect(links.map((l) => [l.target, l.line])).toEqual([
      ["notes/Arquitectura/contrato.md", 4],
      ["notes/Arquitectura/contrato.md", 9],
      ["notes/reuniones/otro.md", 9],
    ]);
    expect(links[0]!.text).toContain("Ver [contrato]");
  });

  it("trims a long context line", () => {
    const long = `[a](b.md) ${"x".repeat(300)}`;
    const [link] = extractLinks(long, "n.md");
    expect(link!.text.length).toBeLessThanOrEqual(161);
    expect(link!.text.endsWith("…")).toBe(true);
  });
});

describe("indexNotes", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "ygg-docs-index-"));
    await mkdir(join(root, "notes", "Arquitectura"), { recursive: true });
    await mkdir(join(root, "notes", "node_modules"), { recursive: true });
    await writeFile(join(root, "notes", "00-LEEME.md"), "# Índice\n\nVer [contrato](Arquitectura/contrato.md).\n");
    await writeFile(join(root, "notes", "Arquitectura", "contrato.md"), "# Contrato\n\nVuelve al [índice](../00-LEEME.md).\n");
    await writeFile(join(root, "notes", "sin-titulo.md"), "solo texto\n");
    await writeFile(join(root, "notes", "node_modules", "x.md"), "# Ignorada\n");
    await writeFile(join(root, "notes", "datos.json"), "{}");
  });

  it("indexes every note under the folder with title and links, skipping ignored folders and other files", async () => {
    const { notes, truncated } = await indexNotes({ root, scope: "notes" });
    expect(truncated).toBe(false);
    expect(notes.map((n) => [n.path, n.title])).toEqual([
      ["notes/00-LEEME.md", "Índice"],
      ["notes/Arquitectura/contrato.md", "Contrato"],
      ["notes/sin-titulo.md", "sin-titulo"],
    ]);
    expect(notes[0]!.links.map((l) => l.target)).toEqual(["notes/Arquitectura/contrato.md"]);
    expect(notes[1]!.links.map((l) => l.target)).toEqual(["notes/00-LEEME.md"]);
  });

  it("indexes just the given paths and leaves out the ones that are gone or aren't notes", async () => {
    const { notes } = await indexNotes({ root, scope: "notes", paths: ["notes/00-LEEME.md", "notes/no-existe.md", "notes/datos.json"] });
    expect(notes.map((n) => n.path)).toEqual(["notes/00-LEEME.md"]);
  });
});
