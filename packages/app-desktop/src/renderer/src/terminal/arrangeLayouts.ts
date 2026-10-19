import type { PaneNode } from "../types.js";

// Duplicated (not imported) from paneTree.ts's own aliases of the same
// Extract — paneTree.ts imports buildArrangedRoot/evenSizes from this
// module, so importing paneTree.ts's own exports back here would be a
// circular module dependency between the two.
type LeafPane = Extract<PaneNode, { type: "leaf" }>;
type SplitPane = Extract<PaneNode, { type: "split" }>;

export type ArrangeLayout = "row" | "2row" | "2x2" | "3x3" | "auto";

export function evenSizes(count: number): number[] {
  const base = Math.floor((1 / count) * 1000) / 1000;
  const sizes = new Array(count).fill(base);
  sizes[count - 1] = 1 - base * (count - 1);
  return sizes;
}

/** Wraps every `size` leaves into a new row (the last row may be shorter) — the shared primitive every grid-shaped layout below is built from. */
export function chunkFixed(leaves: LeafPane[], size: number): LeafPane[][] {
  const rows: LeafPane[][] = [];
  for (let i = 0; i < leaves.length; i += size) rows.push(leaves.slice(i, i + size));
  return rows;
}

/** Divides leaves into exactly `rowCount` groups (or fewer if there aren't enough leaves), as evenly as possible. */
export function splitIntoRows(leaves: LeafPane[], rowCount: number): LeafPane[][] {
  if (leaves.length === 0) return [];
  const perRow = Math.ceil(leaves.length / rowCount);
  return chunkFixed(leaves, perRow);
}

function buildRowSplit(leaves: LeafPane[]): PaneNode {
  if (leaves.length === 1) return leaves[0]!;
  return { type: "split", id: crypto.randomUUID(), direction: "row", sizes: evenSizes(leaves.length), children: leaves };
}

/** A `direction:"column"` split whose children are each `buildRowSplit(row)` — the shared "grid via nested splits" primitive every multi-row layout is built from. */
function buildColumnOfRows(rows: LeafPane[][]): PaneNode {
  const rowNodes = rows.map(buildRowSplit);
  if (rowNodes.length === 1) return rowNodes[0]!;
  return {
    type: "split",
    id: crypto.randomUUID(),
    direction: "column",
    sizes: evenSizes(rowNodes.length),
    children: rowNodes as SplitPane["children"],
  };
}

/**
 * Builds a fresh tree shape for the given layout out of the *same* leaf
 * objects (same ids) — since PaneNodeView keys children by id, reusing them
 * means no TerminalPane remounts, no pty disposal. This is a pure visual
 * reflow, never a respawn.
 */
export function buildArrangedRoot(layout: ArrangeLayout, leaves: LeafPane[]): PaneNode | null {
  if (leaves.length === 0) return null;

  switch (layout) {
    case "row":
      return buildRowSplit(leaves);

    case "2row":
      // Row *count* fixed at 2 — columns per row vary to fit everything in.
      return buildColumnOfRows(splitIntoRows(leaves, 2));

    case "2x2":
      // Column *count* fixed at 2 — wraps to additional rows past 4 leaves
      // rather than overflowing a single row.
      return buildColumnOfRows(chunkFixed(leaves, 2));

    case "3x3":
      return buildColumnOfRows(chunkFixed(leaves, 3));

    case "auto": {
      // Spotlight: leaf #1 (by convention, the orchestrator — a loaded Team
      // spawns only it first, workers get appended afterward via
      // create_pane) stays large on the left; everything else auto-grids
      // on the right, column count scaling with how many are left.
      if (leaves.length === 1) return leaves[0]!;
      const [first, ...rest] = leaves as [LeafPane, ...LeafPane[]];
      const cols = Math.max(1, Math.ceil(Math.sqrt(rest.length)));
      const restGrid = buildColumnOfRows(chunkFixed(rest, cols));
      return {
        type: "split",
        id: crypto.randomUUID(),
        direction: "row",
        sizes: [0.6, 0.4],
        children: [first, restGrid],
      };
    }

    default:
      return buildRowSplit(leaves);
  }
}
