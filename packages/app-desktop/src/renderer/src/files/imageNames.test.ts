import { describe, expect, it } from "vitest";
import { altFromFileName, imageFileName, isImageFile, isImageName, relativeFromNote } from "./imageNames.js";

describe("isImageName / isImageFile", () => {
  it("goes by extension or by type", () => {
    expect(isImageName("a.PNG")).toBe(true);
    expect(isImageName("a.pdf")).toBe(false);
    expect(isImageFile({ name: "x", type: "image/webp" })).toBe(true);
    expect(isImageFile({ name: "foto.jpg", type: "" })).toBe(true);
    expect(isImageFile({ name: "doc.txt", type: "text/plain" })).toBe(false);
  });
});

describe("imageFileName", () => {
  const now = new Date(2026, 10, 4, 9, 5, 7);

  it("keeps a real name", () => {
    expect(imageFileName({ name: "diagrama.png", type: "image/png" }, now)).toBe("diagrama.png");
  });

  it("replaces the generic name a pasted screenshot gets, using the type for the extension", () => {
    expect(imageFileName({ name: "image.png", type: "image/png" }, now)).toBe("imagen-20261104-090507.png");
    expect(imageFileName({ name: "", type: "image/jpeg" }, now)).toBe("imagen-20261104-090507.jpg");
    expect(imageFileName({ name: "", type: "" }, now)).toBe("imagen-20261104-090507.png");
  });

  it("names a file that has an image type but a non-image name", () => {
    expect(imageFileName({ name: "captura", type: "image/gif" }, now)).toBe("imagen-20261104-090507.gif");
  });
});

describe("altFromFileName", () => {
  it("is the name without extension, with dashes and underscores as spaces", () => {
    expect(altFromFileName("diagrama-de_panes.png")).toBe("diagrama de panes");
    expect(altFromFileName("assets/a.png")).toBe("a");
    expect(altFromFileName("sin-ext")).toBe("sin ext");
  });
});

describe("relativeFromNote", () => {
  it("is relative to the note's folder", () => {
    expect(relativeFromNote("notes/a/n.md", "notes/a/assets/x.png")).toBe("assets/x.png");
    expect(relativeFromNote("notes/a/n.md", "notes/a/x.png")).toBe("x.png");
  });

  it("climbs with .. to reach other folders", () => {
    expect(relativeFromNote("notes/a/n.md", "notes/b/x.png")).toBe("../b/x.png");
    expect(relativeFromNote("notes/a/b/n.md", "img/x.png")).toBe("../../../img/x.png");
    expect(relativeFromNote("n.md", "assets/x.png")).toBe("assets/x.png");
  });
});
