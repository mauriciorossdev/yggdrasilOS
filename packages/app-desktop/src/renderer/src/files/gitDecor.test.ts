import { describe, expect, it } from "vitest";
import { buildGitDecor } from "./gitDecor.js";

describe("buildGitDecor", () => {
  it("letters the files and marks every ancestor folder", () => {
    const d = buildGitDecor([
      { path: "packages/app/src/a.ts", status: "modified" },
      { path: "packages/app/src/b.ts", status: "added" },
      { path: "README.md", status: "untracked" },
    ]);
    expect(d.files.get("packages/app/src/a.ts")).toBe("M");
    expect(d.files.get("packages/app/src/b.ts")).toBe("A");
    expect(d.files.get("README.md")).toBe("?");
    expect([...d.dirs].sort()).toEqual(["packages", "packages/app", "packages/app/src"]);
  });

  it("marks an untracked folder (git lists it as dir/) and its parents, not as a file", () => {
    const d = buildGitDecor([{ path: "apps/new/", status: "untracked" }]);
    expect(d.files.size).toBe(0);
    expect([...d.dirs].sort()).toEqual(["apps", "apps/new"]);
  });

  it("maps deleted, renamed and unmerged, and survives an empty list", () => {
    const d = buildGitDecor([
      { path: "a", status: "deleted" },
      { path: "b", status: "renamed" },
      { path: "c", status: "unmerged" },
    ]);
    expect([d.files.get("a"), d.files.get("b"), d.files.get("c")]).toEqual(["D", "R", "!"]);
    expect(buildGitDecor([]).dirs.size).toBe(0);
  });
});
