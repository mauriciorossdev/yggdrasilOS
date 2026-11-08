import { describe, expect, it } from "vitest";
import { imageAttrsFromElement, imageRenderSpec } from "./imageNode.js";

describe("imageRenderSpec", () => {
  it("loads the display address and keeps the markdown one in data-src", () => {
    expect(imageRenderSpec({ src: "assets/a.png", alt: "Diagrama" }, "ygg-file://f/p/notes/assets/a.png")).toEqual([
      "img",
      { src: "ygg-file://f/p/notes/assets/a.png", "data-src": "assets/a.png", alt: "Diagrama" },
    ]);
  });

  it("omits empty alt and title", () => {
    const [, attrs] = imageRenderSpec({ src: "a.png", alt: "", title: null }, "x");
    expect(attrs).not.toHaveProperty("alt");
    expect(attrs).not.toHaveProperty("title");
  });
});

describe("imageAttrsFromElement", () => {
  const el = (attrs: Record<string, string>) => (name: string) => attrs[name] ?? null;

  it("prefers data-src, so a copy inside the editor doesn't write the loadable address into the file", () => {
    expect(imageAttrsFromElement(el({ "data-src": "assets/a.png", src: "ygg-file://f/p/notes/assets/a.png", alt: "A" }))).toEqual({
      src: "assets/a.png",
      alt: "A",
      title: null,
    });
  });

  it("falls back to src (markdown rendered to HTML has no data-src) and rejects an image without one", () => {
    expect(imageAttrsFromElement(el({ src: "assets/a.png", title: "T" }))).toEqual({ src: "assets/a.png", alt: null, title: "T" });
    expect(imageAttrsFromElement(el({}))).toBe(false);
  });
});
