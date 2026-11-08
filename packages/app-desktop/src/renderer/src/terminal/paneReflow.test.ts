import { describe, expect, it } from "vitest";
import { collectLeaves, projectReflowedTree, REFLOW_ID_PREFIX, type LeafPane } from "./paneTree.js";
import { buildArrangedRoot } from "./arrangeLayouts.js";

const leaf = (id: string): LeafPane => ({ type: "leaf", id, title: id, cwd: "/" });
const leaves = (n: number) => Array.from({ length: n }, (_, i) => leaf(`p${i}`));

describe("projectReflowedTree", () => {
  it("returns the tree untouched when nothing is minimized", () => {
    const root = buildArrangedRoot("3x3", leaves(6));
    expect(projectReflowedTree(root, new Set())).toBe(root);
  });

  it("refills a 3x3 grid evenly when panes are minimized", () => {
    const root = buildArrangedRoot("3x3", leaves(9));
    const out = projectReflowedTree(root, new Set(["p0", "p1", "p2", "p3", "p4"]))!;
    expect(collectLeaves(out).map((l) => l.id)).toEqual(["p5", "p6", "p7", "p8"]);
    // 4 left -> 2x2, not the old 3-wide rows
    expect(out.type === "split" && out.direction).toBe("column");
    expect(out.type === "split" && out.children.map((c) => (c.type === "split" ? c.children.length : 1))).toEqual([2, 2]);
  });

  it("two visible panes sit side by side; one fills everything; none gives null", () => {
    const root = buildArrangedRoot("2x2", leaves(4));
    const two = projectReflowedTree(root, new Set(["p0", "p1"]))!;
    expect(two.type === "split" && two.direction).toBe("row");
    expect(projectReflowedTree(root, new Set(["p0", "p1", "p2"]))).toMatchObject({ type: "leaf", id: "p3" });
    expect(projectReflowedTree(root, new Set(["p0", "p1", "p2", "p3"]))).toBeNull();
  });

  it("gives the same split ids for the same panes (no remounts) and honours size overrides", () => {
    const root = buildArrangedRoot("row", leaves(4));
    const a = projectReflowedTree(root, new Set(["p0"]))!;
    const b = projectReflowedTree(root, new Set(["p0"]))!;
    expect(a.id).toBe(b.id);
    expect(a.id.startsWith(REFLOW_ID_PREFIX)).toBe(true);
    const c = projectReflowedTree(root, new Set(["p0"]), { [a.id]: [0.7, 0.3] })!;
    expect(c.type === "split" && c.sizes).toEqual([0.7, 0.3]);
  });
});
