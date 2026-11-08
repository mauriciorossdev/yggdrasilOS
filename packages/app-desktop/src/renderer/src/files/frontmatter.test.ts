import { describe, expect, it } from "vitest";
import { joinFrontmatter, otherKeys, parseProps, setProperty, splitFrontmatter } from "./frontmatter.js";

const NOTE = `---
title: Plan de lanzamiento
status: en curso
date: 2026-05-01
tags: [producto, q3]
author: Alex
---
# Hola

Cuerpo.
`;

describe("splitFrontmatter", () => {
  it("separates the block and keeps the original text recoverable", () => {
    const { raw, body } = splitFrontmatter(NOTE);
    expect(raw.startsWith("---\ntitle:")).toBe(true);
    expect(raw.endsWith("---\n")).toBe(true);
    expect(body).toBe("# Hola\n\nCuerpo.\n");
    expect(joinFrontmatter(raw, body)).toBe(NOTE);
  });

  it("returns no front matter for a plain note", () => {
    expect(splitFrontmatter("# Solo\n")).toEqual({ raw: "", body: "# Solo\n" });
  });

  it("does not take a horizontal rule pair around prose for front matter", () => {
    const md = "---\nUna frase suelta\n---\nDespués\n";
    expect(splitFrontmatter(md)).toEqual({ raw: "", body: md });
  });

  it("ignores an unclosed block", () => {
    const md = "---\ntitle: x\n# Sin cierre\n";
    expect(splitFrontmatter(md).raw).toBe("");
  });

  it("handles CRLF", () => {
    const md = "---\r\ntitle: A\r\n---\r\nTexto\r\n";
    const { raw, body } = splitFrontmatter(md);
    expect(body).toBe("Texto\r\n");
    expect(raw + body).toBe(md);
  });
});

describe("parseProps", () => {
  it("reads the known properties", () => {
    expect(parseProps(NOTE)).toEqual({
      title: "Plan de lanzamiento",
      status: "en curso",
      date: "2026-05-01",
      tags: ["producto", "q3"],
    });
  });

  it("reads block-list tags and quoted values", () => {
    const md = `---\ntitle: "Uno: dos"\ntags:\n  - a\n  - "#b"\n---\n`;
    expect(parseProps(md)).toMatchObject({ title: "Uno: dos", tags: ["a", "b"] });
  });

  it("reads comma-separated tags", () => {
    expect(parseProps("---\ntags: x, y\n---\n").tags).toEqual(["x", "y"]);
  });

  it("is empty for a note without front matter", () => {
    expect(parseProps("# Hola")).toEqual({ title: "", status: "", date: "", tags: [] });
  });
});

describe("otherKeys", () => {
  it("lists the properties the panel has no field for", () => {
    expect(otherKeys(NOTE)).toEqual(["author"]);
  });
});

describe("setProperty", () => {
  it("changes only the line of that property", () => {
    const out = setProperty(NOTE, "status", "hecho");
    expect(out).toBe(NOTE.replace("status: en curso", "status: hecho"));
  });

  it("appends a property that was missing", () => {
    const out = setProperty("---\ntitle: A\n---\nTexto\n", "date", "2026-01-02");
    expect(out).toBe("---\ntitle: A\ndate: 2026-01-02\n---\nTexto\n");
  });

  it("creates the block in a note that had none", () => {
    expect(setProperty("# Hola\n", "title", "Mi nota")).toBe("---\ntitle: Mi nota\n---\n# Hola\n");
  });

  it("removes the line when the value is emptied, and the block when nothing is left", () => {
    expect(setProperty("---\ntitle: A\nstatus: b\n---\nx\n", "status", "")).toBe("---\ntitle: A\n---\nx\n");
    expect(setProperty("---\ntitle: A\n---\nx\n", "title", "")).toBe("x\n");
  });

  it("writes tags inline, replacing a block list", () => {
    const md = "---\ntags:\n  - a\n  - b\nstatus: ok\n---\nx\n";
    expect(setProperty(md, "tags", ["a", "b", "c d"])).toBe("---\ntags: [a, b, c-d]\nstatus: ok\n---\nx\n");
  });

  it("quotes values YAML would misread", () => {
    expect(setProperty("x\n", "title", "Plan: v2")).toContain('title: "Plan: v2"');
    expect(setProperty("x\n", "title", "true")).toContain('title: "true"');
    expect(parseProps(setProperty("x\n", "title", 'Dice "hola": sí')).title).toBe('Dice "hola": sí');
  });

  it("keeps comments and unknown properties", () => {
    const md = "---\n# nota\nauthor: Yo\ntitle: A\n---\nx\n";
    expect(setProperty(md, "title", "B")).toBe("---\n# nota\nauthor: Yo\ntitle: B\n---\nx\n");
  });

  it("keeps CRLF line endings", () => {
    const out = setProperty("---\r\ntitle: A\r\n---\r\nx\r\n", "status", "ok");
    expect(out).toBe("---\r\ntitle: A\r\nstatus: ok\r\n---\r\nx\r\n");
  });
});
