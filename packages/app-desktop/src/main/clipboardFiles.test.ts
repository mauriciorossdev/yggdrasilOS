import { describe, expect, it, vi } from "vitest";

// clipboardFiles imports electron's clipboard at module load; the pure helpers don't touch it.
vi.mock("electron", () => ({ clipboard: {} }));

const { firstFileUrl, gnomeCopiedFiles, macFilenamesPlist, parseMacFilenamesPlist, rawClipboardType } = await import("./clipboardFiles.js");

describe("macFilenamesPlist / parseMacFilenamesPlist", () => {
  it("round-trips a list of paths", () => {
    const paths = ["/Users/me/proj/a.txt", "/Users/me/proj/sub dir/b.md"];
    expect(parseMacFilenamesPlist(macFilenamesPlist(paths))).toEqual(paths);
  });

  it("escapes characters that are special in XML and restores them", () => {
    const paths = ["/p/R&D <draft>/x.txt"];
    const xml = macFilenamesPlist(paths);
    expect(xml).toContain("R&amp;D &lt;draft&gt;");
    expect(parseMacFilenamesPlist(xml)).toEqual(paths);
  });

  it("is a plist Finder recognizes (header, array of strings)", () => {
    const xml = macFilenamesPlist(["/a"]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<plist version="1.0"><array><string>/a</string></array></plist>');
  });

  it("reads a Finder-style plist with whitespace between items, and gives nothing for anything else", () => {
    const finder = '<?xml version="1.0"?><plist version="1.0"><array>\n\t<string>/one</string>\n\t<string>/two words</string>\n</array></plist>';
    expect(parseMacFilenamesPlist(finder)).toEqual(["/one", "/two words"]);
    expect(parseMacFilenamesPlist("bplist00\u0000garbage")).toEqual([]);
    expect(parseMacFilenamesPlist("")).toEqual([]);
  });
});

describe("gnomeCopiedFiles", () => {
  it("is the copy action followed by one file URI per line", () => {
    expect(gnomeCopiedFiles(["/home/me/a b.txt", "/home/me/c"])).toBe("copy\nfile:///home/me/a%20b.txt\nfile:///home/me/c");
  });
});

describe("firstFileUrl", () => {
  it("takes the first file URL, ignoring other lines and line endings", () => {
    expect(firstFileUrl("# comment\r\nfile:///a/b.txt\r\nfile:///c")).toBe("file:///a/b.txt");
  });

  it("finds nothing without one", () => {
    expect(firstFileUrl("")).toBeNull();
    expect(firstFileUrl("https://example.com")).toBeNull();
  });
});

describe("rawClipboardType", () => {
  it("wraps a platform format the way Electron expects", () => {
    expect(rawClipboardType("public.file-url")).toBe('electron application/osclipboard;format="public.file-url"');
  });
});
