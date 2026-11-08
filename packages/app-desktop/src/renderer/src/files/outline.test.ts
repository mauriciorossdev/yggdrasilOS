import { describe, expect, it } from "vitest";
import { activeOutlineIndex, extractOutline, outlineDepths, plainHeadingText } from "./outline.js";

describe("plainHeadingText", () => {
  it("drops inline markdown but keeps the words", () => {
    expect(plainHeadingText("**Qué** leer `primero` y [esto](https://x.y)")).toBe("Qué leer primero y esto");
    expect(plainHeadingText("Título ##")).toBe("Título");
    expect(plainHeadingText("![logo](a.png) Marca")).toBe("logo Marca");
  });
});

describe("extractOutline", () => {
  const md = [
    "---",
    "titulo: X",
    "# no es un título, está en el frontmatter",
    "---",
    "# Índice maestro",
    "texto",
    "## Qué leer primero",
    "```bash",
    "# comentario de shell, no un título",
    "```",
    "### Detalle **fino**",
    "#sin-espacio no cuenta",
    "~~~",
    "## tampoco este",
    "~~~",
    "## Mapa de carpetas",
  ].join("\n");

  it("lists the ATX headings with level and line, skipping front matter and code fences", () => {
    expect(extractOutline(md)).toEqual([
      { level: 1, text: "Índice maestro", line: 5 },
      { level: 2, text: "Qué leer primero", line: 7 },
      { level: 3, text: "Detalle fino", line: 11 },
      { level: 2, text: "Mapa de carpetas", line: 16 },
    ]);
  });

  it("is empty for a note with no headings, and ignores an empty heading", () => {
    expect(extractOutline("solo texto\n\nmás texto")).toEqual([]);
    expect(extractOutline("# \n## real")).toEqual([{ level: 2, text: "real", line: 2 }]);
  });

  it("copes with CRLF line endings", () => {
    expect(extractOutline("# Uno\r\ntexto\r\n## Dos\r\n").map((i) => i.line)).toEqual([1, 3]);
  });
});

describe("activeOutlineIndex", () => {
  const items = [
    { level: 1, text: "A", line: 1 },
    { level: 2, text: "B", line: 10 },
    { level: 2, text: "C", line: 20 },
  ];

  it("is the section the line falls in", () => {
    expect(activeOutlineIndex(items, 1)).toBe(0);
    expect(activeOutlineIndex(items, 9)).toBe(0);
    expect(activeOutlineIndex(items, 10)).toBe(1);
    expect(activeOutlineIndex(items, 99)).toBe(2);
  });

  it("is -1 before the first heading and for an empty outline", () => {
    expect(activeOutlineIndex([{ level: 1, text: "A", line: 5 }], 2)).toBe(-1);
    expect(activeOutlineIndex([], 3)).toBe(-1);
  });
});

describe("outlineDepths", () => {
  it("indents relative to the shallowest level present, capped", () => {
    const items = [2, 3, 4, 2].map((level) => ({ level, text: "x" }));
    expect(outlineDepths(items)).toEqual([0, 1, 2, 0]);
    expect(outlineDepths([{ level: 1, text: "a" }, { level: 6, text: "b" }])).toEqual([0, 4]);
    expect(outlineDepths([])).toEqual([]);
  });
});
