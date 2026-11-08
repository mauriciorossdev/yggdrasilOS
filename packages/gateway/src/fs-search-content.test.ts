import { beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findMatches, searchContent, snippetOf } from "./fs-search-content.js";

describe("snippetOf", () => {
  it("keeps a short line whole and locates the match inside it", () => {
    const s = snippetOf("Contrato de flujos oficiales", 12, 6);
    expect(s.text).toBe("Contrato de flujos oficiales");
    expect(s.text.slice(s.matchStart, s.matchEnd)).toBe("flujos");
  });

  it("cuts a long line to a window around the match, with ellipses, and still points at the match", () => {
    const line = `${"a".repeat(200)} NEEDLE ${"b".repeat(200)}`;
    const s = snippetOf(line, 201, 6);
    expect(s.text.startsWith("…")).toBe(true);
    expect(s.text.endsWith("…")).toBe(true);
    expect(s.text.length).toBeLessThan(170);
    expect(s.text.slice(s.matchStart, s.matchEnd)).toBe("NEEDLE");
  });
});

describe("findMatches", () => {
  const text = "uno flujo\nsin nada\nDos FLUJOS y otro flujo\r\nfin";

  it("counts every occurrence case-insensitively and reports the first one per line", () => {
    const { matches, snippets } = findMatches(text, "flujo", 5);
    expect(matches).toBe(3);
    expect(snippets.map((s) => s.line)).toEqual([1, 3]);
    expect(snippets[1]!.text.slice(snippets[1]!.matchStart, snippets[1]!.matchEnd)).toBe("FLUJO");
  });

  it("stops collecting snippets at the cap but keeps counting", () => {
    const { matches, snippets } = findMatches("a\na\na\na", "a", 2);
    expect(matches).toBe(4);
    expect(snippets).toHaveLength(2);
  });
});

describe("searchContent", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "ygg-search-content-"));
    await mkdir(join(root, "notes", "Arquitectura"), { recursive: true });
    await mkdir(join(root, "notes", "reuniones"), { recursive: true });
    await mkdir(join(root, "notes", "node_modules", "x"), { recursive: true });
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "notes", "Arquitectura", "contrato-flujos.md"), "# Contrato\nDefine los estados.\n");
    await writeFile(join(root, "notes", "Arquitectura", "resumen.md"), "Resumen general.\nLos flujos dependen del contrato.\nOtros flujos más.\n");
    await writeFile(join(root, "notes", "reuniones", "2026-10-02.md"), "Se acordó migrar el esquema.\nRevisar un flujo con producto.\n");
    await writeFile(join(root, "notes", "node_modules", "x", "flujos.md"), "flujos en una carpeta ignorada\n");
    await writeFile(join(root, "notes", "imagen.png"), "flujos dentro de un png falso");
    await writeFile(join(root, "notes", "binario.dat"), Buffer.from([102, 108, 117, 106, 111, 115, 0, 1, 2]));
    await writeFile(join(root, "src", "app.ts"), "// flujos fuera de notes\n");
  });

  it("finds files by name and by what they say, name matches first, then by number of hits", async () => {
    const { results } = await searchContent({ root, scope: "notes", query: "flujos" });
    expect(results.map((r) => r.relativePath)).toEqual([
      "notes/Arquitectura/contrato-flujos.md",
      "notes/Arquitectura/resumen.md",
    ]);
    expect(results[0]).toMatchObject({ nameMatch: true, matches: 0 });
    expect(results[1]).toMatchObject({ nameMatch: false, matches: 2 });
  });

  it("returns snippets with the matched part located", async () => {
    const { results } = await searchContent({ root, scope: "notes", query: "migrar" });
    expect(results).toHaveLength(1);
    const snippet = results[0]!.snippets[0]!;
    expect(snippet.line).toBe(1);
    expect(snippet.text.slice(snippet.matchStart, snippet.matchEnd)).toBe("migrar");
  });

  it("stays inside the scope, skips ignored folders, binary files and unrelated extensions", async () => {
    const { results } = await searchContent({ root, scope: "notes", query: "flujos" });
    const paths = results.map((r) => r.relativePath);
    expect(paths.some((p) => p.startsWith("src/"))).toBe(false);
    expect(paths.some((p) => p.includes("node_modules"))).toBe(false);
    expect(paths).not.toContain("notes/imagen.png");
    expect(paths).not.toContain("notes/binario.dat");
  });

  it("searches the whole workspace when no scope is given", async () => {
    const { results } = await searchContent({ root, query: "fuera de notes" });
    expect(results.map((r) => r.relativePath)).toEqual(["src/app.ts"]);
  });

  it("is case-insensitive, ignores surrounding spaces and gives nothing for an empty query", async () => {
    expect((await searchContent({ root, scope: "notes", query: "  MIGRAR " })).results).toHaveLength(1);
    expect(await searchContent({ root, scope: "notes", query: "   " })).toEqual({ results: [], truncated: false });
  });

  it("caps the results and says it did", async () => {
    for (let i = 0; i < 6; i++) await writeFile(join(root, "notes", `lote-${i}.md`), "palabra repetida\n");
    const outcome = await searchContent({ root, scope: "notes", query: "palabra", limit: 3 });
    expect(outcome.results).toHaveLength(3);
    expect(outcome.truncated).toBe(true);
  });
});
