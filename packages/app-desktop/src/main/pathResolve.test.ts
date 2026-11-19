import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { candidatePaths, relativeToRoot, resolveTerminalPath } from "./pathResolve.js";

describe("candidatePaths", () => {
  it("expands ~, keeps absolute, tries cwd then project for relative", () => {
    expect(candidatePaths("~/x/y", null, null, "/home/me")).toEqual(["/home/me/x/y"]);
    expect(candidatePaths("/abs/p", "/cwd", "/proj")).toEqual(["/abs/p"]);
    expect(candidatePaths("src/a.ts", "/proj/.wt/one", "/proj")).toEqual(["/proj/.wt/one/src/a.ts", "/proj/src/a.ts"]);
    expect(candidatePaths("./src/a.ts", "/proj", "/proj")).toEqual(["/proj/src/a.ts"]);
  });
});

describe("resolveTerminalPath", () => {
  it("classifies files, folders, outside paths and missing ones", async () => {
    const root = await mkdtemp(join(tmpdir(), "ygg-path-"));
    const project = join(root, "proj");
    await mkdir(join(project, "src"), { recursive: true });
    await writeFile(join(project, "src", "a.ts"), "");
    await mkdir(join(root, "outside"));

    expect(await resolveTerminalPath("src/a.ts", project, project)).toMatchObject({
      kind: "file",
      insideProject: true,
      relativePath: "src/a.ts",
    });
    expect(await resolveTerminalPath(join(project, "src"), null, project)).toMatchObject({
      kind: "directory",
      relativePath: "src",
    });
    expect(await resolveTerminalPath(join(root, "outside"), null, project)).toMatchObject({
      kind: "directory",
      insideProject: false,
    });
    expect(await resolveTerminalPath("src/missing.ts", project, project)).toBeNull();
  });
});

describe("relativeToRoot with dot-prefixed names", () => {
  it("treats ..name inside the project as inside, and a real parent as outside", () => {
    expect(relativeToRoot("/proj/..cache/x.ts", "/proj")).toBe("..cache/x.ts");
    expect(relativeToRoot("/proj/..foo.xlsx", "/proj")).toBe("..foo.xlsx");
    expect(relativeToRoot("/other/x.ts", "/proj")).toBeNull();
    expect(relativeToRoot("/proj", "/proj")).toBe("");
  });
});
