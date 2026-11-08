import { describe, expect, it } from "vitest";
import { countWords, readingMinutes } from "./textStats.js";

describe("countWords", () => {
  it("counts plain words", () => {
    expect(countWords("uno dos  tres\ncuatro")).toBe(4);
    expect(countWords("")).toBe(0);
  });

  it("ignores markdown syntax but keeps the visible text", () => {
    const md = "# Título de prueba\n\n- [x] hecho\n- otra **cosa** _importante_\n\n> una cita\n\n1. primero\n2. segundo\n\n`código` y [un enlace](https://example.com/ruta) con ![imagen](a.png)";
    expect(countWords(md)).toBe(17);
  });

  it("skips front matter and code fence markers, not the code inside", () => {
    const md = "---\ntitulo: X\netiquetas: [a, b]\n---\nHola mundo\n\n```ts\nconst a = 1\n```\n";
    expect(countWords(md)).toBe(5);
  });

  it("doesn't count lone punctuation", () => {
    expect(countWords("---\n\n***\n- \n")).toBe(0);
    expect(countWords("hola — mundo")).toBe(2);
  });
});

describe("readingMinutes", () => {
  it("is zero for nothing, one minute for a short note, then about 220 words a minute", () => {
    expect(readingMinutes(0)).toBe(0);
    expect(readingMinutes(40)).toBe(1);
    expect(readingMinutes(220)).toBe(1);
    expect(readingMinutes(660)).toBe(3);
  });
});
