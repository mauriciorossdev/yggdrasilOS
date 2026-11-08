import { describe, expect, it } from "vitest";
import { extensionForMime, generatedAssetName, isImageName, sanitizeAssetName, uniqueAssetName } from "./noteAssets.js";

describe("extensionForMime / isImageName", () => {
  it("maps the image types a clipboard can carry", () => {
    expect(extensionForMime("image/png")).toBe("png");
    expect(extensionForMime("image/jpeg")).toBe("jpg");
    expect(extensionForMime("IMAGE/WEBP")).toBe("webp");
    expect(extensionForMime("application/pdf")).toBeUndefined();
  });

  it("recognizes image file names by extension, any case", () => {
    expect(isImageName("a.PNG")).toBe(true);
    expect(isImageName("foto.jpeg")).toBe(true);
    expect(isImageName("doc.pdf")).toBe(false);
    expect(isImageName(".png")).toBe(false);
    expect(isImageName("noext")).toBe(false);
  });
});

describe("sanitizeAssetName", () => {
  it("replaces spaces and strange characters, drops accents, and lowercases the extension", () => {
    expect(sanitizeAssetName("Mi captura de pantalla (1).PNG")).toBe("Mi-captura-de-pantalla-1.png");
    expect(sanitizeAssetName("diagrama ñandú.jpg")).toBe("diagrama-nandu.jpg");
  });

  it("keeps only the file name of a path and trims dots and dashes at the edges", () => {
    expect(sanitizeAssetName("../../etc/passwd.png")).toBe("passwd.png");
    expect(sanitizeAssetName("C:\\fotos\\a b.gif")).toBe("a-b.gif");
    expect(sanitizeAssetName("---.png")).toBe("imagen.png");
    expect(sanitizeAssetName("")).toBe("imagen");
  });

  it("caps very long names", () => {
    expect(sanitizeAssetName(`${"a".repeat(200)}.png`).length).toBeLessThanOrEqual(64);
  });
});

describe("generatedAssetName", () => {
  it("is imagen-<date>-<time>.<ext>", () => {
    expect(generatedAssetName(new Date(2026, 10, 4, 9, 5, 7), "png")).toBe("imagen-20261104-090507.png");
  });
});

describe("uniqueAssetName", () => {
  it("leaves a free name alone and numbers a taken one, ignoring case", () => {
    expect(uniqueAssetName("a.png", [])).toBe("a.png");
    expect(uniqueAssetName("a.png", ["a.png"])).toBe("a-2.png");
    expect(uniqueAssetName("a.png", ["A.PNG", "a-2.png"])).toBe("a-3.png");
    expect(uniqueAssetName("sinext", ["sinext"])).toBe("sinext-2");
  });
});
