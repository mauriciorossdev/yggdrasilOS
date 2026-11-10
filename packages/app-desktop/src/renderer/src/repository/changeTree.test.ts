import { describe, expect, it } from "vitest";
import { buildChangeTree, sortByPath, type ChangeTreeNode } from "./changeTree.js";

const id = (p: string) => p;

/** "dir name (count) [children]" / "file name" — compact shape for assertions. */
function shape(nodes: ChangeTreeNode<string>[]): unknown[] {
  return nodes.map((n) => (n.type === "file" ? n.name : { [`${n.name} (${n.count})`]: shape(n.children) }));
}

describe("buildChangeTree", () => {
  it("puts folders first, then files, alphabetical and case-insensitive", () => {
    const tree = buildChangeTree(["b.md", "src/z.ts", "A.md", "docs/x.md", "src/a.ts"], id);
    expect(shape(tree)).toEqual([{ "docs (1)": ["x.md"] }, { "src (2)": ["a.ts", "z.ts"] }, "A.md", "b.md"]);
  });

  it("compacts chains of single folders", () => {
    const tree = buildChangeTree(["apps/nextjs/src/page.tsx", "apps/nextjs/src/lib/db.ts", "apps/nextjs/next-env.d.ts"], id);
    expect(shape(tree)).toEqual([{ "apps/nextjs (3)": [{ "src (2)": [{ "lib (1)": ["db.ts"] }, "page.tsx"] }, "next-env.d.ts"] }]);
    const dir = tree[0];
    expect(dir?.type === "dir" && dir.path).toBe("apps/nextjs");
    const src = dir?.type === "dir" ? dir.children[0] : undefined;
    expect(src?.type === "dir" && src.path).toBe("apps/nextjs/src");
  });

  it("keeps the full path and the item on file nodes", () => {
    const items = [{ path: ".claude/guide.md", letter: "U" }];
    const tree = buildChangeTree(items, (i) => i.path);
    const dir = tree[0];
    const file = dir?.type === "dir" ? dir.children[0] : undefined;
    expect(file).toEqual({ type: "file", name: "guide.md", path: ".claude/guide.md", item: items[0] });
  });

  it("returns nothing for no changes", () => {
    expect(buildChangeTree([], id)).toEqual([]);
  });
});

describe("sortByPath", () => {
  it("groups files of the same folder together", () => {
    expect(sortByPath(["b.md", "src/z.ts", ".claude/x.md", "src/a.ts", "A.md"], id)).toEqual([
      ".claude/x.md",
      "A.md",
      "b.md",
      "src/a.ts",
      "src/z.ts",
    ]);
  });
});
