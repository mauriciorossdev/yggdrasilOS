import { afterEach, describe, expect, it } from "vitest";
import { languageFromPath, setLanguageCatalog } from "./languageFromPath.js";

describe("languageFromPath", () => {
  afterEach(() => setLanguageCatalog([]));

  it("resolves known extensions in any directory, on either separator", () => {
    expect(languageFromPath("src/App.TSX")).toBe("typescript");
    expect(languageFromPath("src\\main.py")).toBe("python");
    expect(languageFromPath("notes/a.b/readme.md")).toBe("markdown");
  });

  it("recognizes files by name", () => {
    expect(languageFromPath("deploy/Dockerfile")).toBe("dockerfile");
    expect(languageFromPath("Dockerfile.prod")).toBe("dockerfile");
    expect(languageFromPath(".env")).toBe("ini");
    expect(languageFromPath("app/.env.local")).toBe("ini");
  });

  it("does not take a directory name for an extension", () => {
    expect(languageFromPath("my.ts/LICENSE")).toBe("plaintext");
  });

  it("falls back to the catalog, behind the table", () => {
    expect(languageFromPath("Main.java")).toBe("plaintext");
    setLanguageCatalog([
      { id: "java", extensions: [".java"] },
      { id: "ini", filenames: [".editorconfig"] },
      { id: "other", extensions: [".ts"] },
    ]);
    expect(languageFromPath("Main.java")).toBe("java");
    expect(languageFromPath(".editorconfig")).toBe("ini");
    expect(languageFromPath("a.ts")).toBe("typescript");
  });
});
