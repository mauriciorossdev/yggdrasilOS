import { describe, expect, it } from "vitest";
import type { FsEntry } from "../types.js";
import { fileKind, isHiddenName, sortEntries } from "./fileKinds.js";

const dir = (name: string): FsEntry => ({ name, type: "directory" }) as FsEntry;
const file = (name: string): FsEntry => ({ name, type: "file" }) as FsEntry;

describe("fileKind", () => {
  it("groups extensions, case-insensitively", () => {
    expect(fileKind("README.md")).toBe("md");
    expect(fileKind("App.TSX")).toBe("code");
    expect(fileKind("package.json")).toBe("json");
    expect(fileKind("pnpm-workspace.yaml")).toBe("config");
    expect(fileKind("styles.css")).toBe("style");
  });

  it("treats dotfiles and unknown extensions as plain files", () => {
    expect(fileKind(".gitignore")).toBe("other");
    expect(fileKind("Makefile")).toBe("other");
    expect(fileKind("photo.png")).toBe("other");
  });
});

describe("isHiddenName", () => {
  it("flags dot and underscore names", () => {
    expect(isHiddenName(".claude")).toBe(true);
    expect(isHiddenName("_backup")).toBe(true);
    expect(isHiddenName("apps")).toBe(false);
  });
});

describe("sortEntries", () => {
  it("puts folders, then files, then hidden folders and hidden files, keeping each group's order", () => {
    const sorted = sortEntries([
      dir("_backup"),
      dir(".claude"),
      dir(".github"),
      file(".gitignore"),
      dir("apps"),
      file("CLAUDE.md"),
      dir("packages"),
      file("package.json"),
    ]).map((e) => e.name);
    expect(sorted).toEqual(["apps", "packages", "CLAUDE.md", "package.json", "_backup", ".claude", ".github", ".gitignore"]);
  });

  it("doesn't mutate its input", () => {
    const input = [file("b"), dir("a")];
    sortEntries(input);
    expect(input.map((e) => e.name)).toEqual(["b", "a"]);
  });
});
