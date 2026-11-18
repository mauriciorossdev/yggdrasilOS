import { describe, expect, it } from "vitest";
import { folderOfTab, folderTabKey, isFolderTab, navigateFolderTab, tabLabel } from "./folderTabs.js";

describe("folderTabs", () => {
  it("round-trips folder keys, root included", () => {
    expect(folderTabKey("src/app")).toBe("src/app/");
    expect(folderTabKey("")).toBe("/");
    expect(folderTabKey(".")).toBe("/");
    expect(folderOfTab("src/app/")).toBe("src/app");
    expect(folderOfTab("/")).toBe("");
    expect(isFolderTab("src/app/")).toBe(true);
    expect(isFolderTab("src/app.ts")).toBe(false);
  });

  it("labels tabs", () => {
    expect(tabLabel("src/app/", "Project")).toBe("app");
    expect(tabLabel("/", "Project")).toBe("Project");
    expect(tabLabel("notes/a.md", "Project")).toBe("a.md");
  });

  it("navigates a folder tab in place", () => {
    expect(navigateFolderTab(["a.ts", "src/", "b.ts"], "src/", "src/app/")).toEqual(["a.ts", "src/app/", "b.ts"]);
    // Destination already open: drop the current one instead of duplicating it.
    expect(navigateFolderTab(["src/", "lib/"], "src/", "lib/")).toEqual(["lib/"]);
  });
});
