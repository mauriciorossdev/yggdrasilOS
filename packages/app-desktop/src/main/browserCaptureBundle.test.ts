import { describe, expect, it } from "vitest";
import { addComment } from "./browserComments.js";
import { buildCaptureBundle, buildCaptureFileName, scopeToMode, slugify } from "./browserCaptureBundle.js";
import type { ExtractedPage } from "./browserExtract.js";

const comment = addComment({}, "p", {
  selector: "#box", tag: "div", text: "t", outerHtml: "<div/>", comment: "x", pageUrl: "https://e.com/a?b=1", pageTitle: "Árbol: guía rápida!", kind: "capture", scope: "element",
}).comment;

const extracted: ExtractedPage = {
  url: "https://e.com/a?b=1", title: "Árbol\nguía", mode: "element", selector: "#box", markdown: "# Hola\n\ncuerpo", truncated: false, totalChars: 14,
  meta: { author: "Ana \"A\"", siteName: "Blog" }, images: [{ src: "https://e.com/i.png", alt: "foto" }], links: [{ href: "https://e.com/l", text: "ver" }], skippedDataImages: 0,
};

describe("slugify / file name", () => {
  it("strips accents and punctuation", () => {
    expect(slugify("Árbol: guía rápida!")).toBe("arbol-guia-rapida");
    expect(slugify("???")).toBe("captura");
    expect(slugify("a".repeat(100)).length).toBeLessThanOrEqual(40);
  });
  it("is sortable and unique per comment", () => {
    const name = buildCaptureFileName(comment, new Date(2026, 9, 28, 14, 30, 5));
    expect(name).toBe(`20261028-143005-arbol-guia-rapida-${comment.id.slice(0, 8)}.md`);
    expect(name).not.toMatch(/[\\/]/);
  });
});

describe("scopeToMode", () => {
  it("maps scopes, url has no extraction", () => {
    expect(scopeToMode("url")).toBeNull();
    expect(scopeToMode("article")).toBe("article");
    expect(scopeToMode("page")).toBe("page");
    expect(scopeToMode("element")).toBe("element");
  });
});

describe("buildCaptureBundle", () => {
  const at = new Date("2026-10-28T14:30:05Z");
  it("has front matter with source, scope, selector and meta, then the content, images and links", () => {
    const out = buildCaptureBundle({ comment, extracted, capturedAt: at });
    expect(out).toContain("source: https://e.com/a?b=1");
    expect(out).toContain("captured_at: 2026-10-28T14:30:05.000Z");
    expect(out).toContain("scope: element");
    expect(out).toContain('selector: "#box"');
    expect(out).toContain('author: "Ana \\"A\\""');
    expect(out).toContain('title: "Árbol guía"'); // newline collapsed: the front matter can't be broken by page text
    expect(out).toContain("# Hola\n\ncuerpo");
    expect(out).toContain("- https://e.com/i.png — foto");
    expect(out).toContain("- https://e.com/l — ver");
    expect(out).toContain("dato no confiable");
  });
  it("flags truncation", () => {
    expect(buildCaptureBundle({ comment, extracted: { ...extracted, truncated: true, totalChars: 999999 }, capturedAt: at })).toContain("truncated: true");
  });
  it("url scope bundle holds just the link", () => {
    const c = { ...comment, scope: "url" as const };
    const out = buildCaptureBundle({ comment: c, extracted: null, capturedAt: at });
    expect(out).toContain("scope: url");
    expect(out).not.toContain("selector:");
    expect(out).toContain("Enlace guardado: https://e.com/a?b=1");
  });
});
