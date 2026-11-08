import { describe, expect, it } from "vitest";
import { displaySrc, isExternalSrc, resolveProjectPath } from "./imageSrc.js";

describe("isExternalSrc", () => {
  it("recognizes web, data and protocol addresses", () => {
    for (const src of ["https://x.y/a.png", "http://x.y/a.png", "data:image/png;base64,AAA", "ygg-file://f/p/a.png", "//cdn.x/a.png"]) {
      expect(isExternalSrc(src)).toBe(true);
    }
    for (const src of ["assets/a.png", "./a.png", "../a.png", "/a.png", "a.png"]) expect(isExternalSrc(src)).toBe(false);
  });
});

describe("resolveProjectPath", () => {
  it("resolves against the note's folder", () => {
    expect(resolveProjectPath("notes/Arquitectura/n.md", "assets/a.png")).toBe("notes/Arquitectura/assets/a.png");
    expect(resolveProjectPath("notes/Arquitectura/n.md", "./a.png")).toBe("notes/Arquitectura/a.png");
    expect(resolveProjectPath("n.md", "assets/a.png")).toBe("assets/a.png");
  });

  it("handles .. and a leading slash (project root)", () => {
    expect(resolveProjectPath("notes/x/n.md", "../shared/a.png")).toBe("notes/shared/a.png");
    expect(resolveProjectPath("notes/x/n.md", "/docs/a.png")).toBe("docs/a.png");
  });

  it("refuses to climb out of the project, and ignores query strings and anchors", () => {
    expect(resolveProjectPath("notes/n.md", "../../../etc/passwd")).toBeNull();
    expect(resolveProjectPath("n.md", "../a.png")).toBeNull();
    expect(resolveProjectPath("notes/n.md", "a.png?raw=1#x")).toBe("notes/a.png");
  });

  it("decodes percent-encoded paths and is null for external or empty ones", () => {
    expect(resolveProjectPath("notes/n.md", "assets/mi%20imagen.png")).toBe("notes/assets/mi imagen.png");
    expect(resolveProjectPath("notes/n.md", "https://x.y/a.png")).toBeNull();
    expect(resolveProjectPath("notes/n.md", "")).toBeNull();
  });
});

describe("displaySrc", () => {
  const fileUrl = (p: string) => `ygg-file://f/proj/${p}`;

  it("turns a project path into a loadable address and leaves external ones alone", () => {
    expect(displaySrc("notes/n.md", "assets/a.png", fileUrl)).toBe("ygg-file://f/proj/notes/assets/a.png");
    expect(displaySrc("notes/n.md", "https://x.y/a.png", fileUrl)).toBe("https://x.y/a.png");
  });

  it("gives back an address that escapes the project unchanged (it will simply not load)", () => {
    expect(displaySrc("n.md", "../a.png", fileUrl)).toBe("../a.png");
  });
});
