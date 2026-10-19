import type { PaneNode, TerminalLayout } from "../types.js";
import { buildArrangedRoot, evenSizes, type ArrangeLayout } from "./arrangeLayouts.js";

export { evenSizes };

export type { PaneNode, TerminalLayout };
export type LeafPane = Extract<PaneNode, { type: "leaf" }>;
export type SplitPane = Extract<PaneNode, { type: "split" }>;

export type PaneAction =
  | { type: "HYDRATE"; layout: TerminalLayout }
  | { type: "ADD_ROOT"; leaf: LeafPane }
  | { type: "SPLIT"; targetId: string; direction: "row" | "column"; newLeaf: LeafPane }
  | { type: "CLOSE"; id: string }
  | { type: "RESIZE"; splitId: string; sizes: number[] }
  | { type: "FOCUS"; id: string }
  | { type: "RENAME"; id: string; title: string }
  | { type: "LOAD_FLOW"; leaves: LeafPane[] }
  | { type: "SWAP_PANES"; id1: string; id2: string }
  | { type: "ARRANGE"; layout: ArrangeLayout }
  | { type: "SET_VIEW_MODE"; mode: "grid" | "canvas" }
  | { type: "SET_CANVAS_POSITIONS"; positions: Array<{ id: string; position: { x: number; y: number } }> };

/** Builds a brand-new blank terminal leaf — shared by TerminalContainer.tsx (New Terminal, Split) and TerminalCanvasView.tsx (Split from a canvas node) so both build the exact same shape. */
export function newLeaf(cwd: string, title: string): LeafPane {
  return { type: "leaf", id: crypto.randomUUID(), title, cwd };
}

export function collectLeaves(root: PaneNode | null): LeafPane[] {
  if (!root) return [];
  if (root.type === "leaf") return [root];
  return root.children.flatMap(collectLeaves);
}


/**
 * Read-only projection of `root` with every leaf in `hiddenIds` removed
 * (and any split left with 0/1 children auto-collapsed, same rule
 * `replaceNode` applies for CLOSE) — used to render a "minimized" pane out
 * of the grid without touching `state.root` itself. Deliberately NOT a
 * PaneAction/reducer case: `state.root` is what the disposal effect in
 * TerminalContainer.tsx diffs against to decide when to kill a pty
 * (terminals.dispose) — minimizing must never make a leaf disappear from
 * `state.root`, or it would be indistinguishable from a real CLOSE.
 */
export function projectVisibleTree(root: PaneNode | null, hiddenIds: Set<string>): PaneNode | null {
  if (!root) return null;
  if (root.type === "leaf") return hiddenIds.has(root.id) ? null : root;

  const kept: PaneNode[] = [];
  const keptSizes: number[] = [];
  root.children.forEach((child, i) => {
    const next = projectVisibleTree(child, hiddenIds);
    if (next) {
      kept.push(next);
      keptSizes.push(root.sizes[i] ?? 1);
    }
  });
  if (kept.length === 0) return null;
  if (kept.length === 1) return kept[0]!;
  return { ...root, children: kept, sizes: keptSizes };
}

function findNode(root: PaneNode | null, id: string): PaneNode | null {
  if (!root) return null;
  if (root.id === id) return root;
  if (root.type === "split") {
    for (const child of root.children) {
      const found = findNode(child, id);
      if (found) return found;
    }
  }
  return null;
}

/** Rebuilds the path from root to the node satisfying `predicate`, replacing it via `transform`. Returns the original root unchanged if nothing matched. */
function replaceNode(
  root: PaneNode | null,
  predicate: (node: PaneNode) => boolean,
  transform: (node: PaneNode) => PaneNode | null,
): PaneNode | null {
  if (!root) return null;
  if (predicate(root)) return transform(root);
  if (root.type === "split") {
    let changed = false;
    const children = root.children
      .map((child) => {
        const next = replaceNode(child, predicate, transform);
        if (next !== child) changed = true;
        return next;
      })
      .filter((n): n is PaneNode => n !== null);
    if (!changed) return root;

    // A child collapsing to null (closed) or a split left with exactly one
    // child both need the parent split itself to collapse — otherwise you'd
    // end up with a single-child split node, which isn't a meaningful shape.
    if (children.length === 1) return children[0]!;
    if (children.length === 0) return null;
    return { ...root, children, sizes: evenSizes(children.length) };
  }
  return root;
}

export function paneReducer(state: TerminalLayout, action: PaneAction): TerminalLayout {
  switch (action.type) {
    case "HYDRATE": {
      // Drop every create_pane-spawned worker (attach:true) — they only
      // ever existed because a live orchestrator conversation called
      // create_pane for them this session; a `claude` pane has no
      // session-resume, so on a real app restart there's no live
      // conversation left to "belong" to. Only terminals the user
      // deliberately keeps open (New Terminal, or a Team's root) survive.
      const survivors = collectLeaves(action.layout.root)
        .filter((l) => !l.attach)
        // Strip initialPrompt too — a restored pane keeps its role/system
        // prompt (systemPromptAppend, still in `args`) but shouldn't
        // silently re-submit its original task on every plain reopen; it
        // should sit idle until the user actually sends it something.
        .map((l) => ({ ...l, initialPrompt: undefined, initialPromptFlag: undefined }));
      if (survivors.length === 0) return { root: null, activePaneId: null, viewMode: action.layout.viewMode };
      const root = buildArrangedRoot("row", survivors);
      const activeSurvived = survivors.some((l) => l.id === action.layout.activePaneId);
      return {
        root,
        activePaneId: activeSurvived ? action.layout.activePaneId : survivors[0]!.id,
        viewMode: action.layout.viewMode,
      };
    }

    case "ADD_ROOT": {
      if (state.root) return state;
      return { ...state, root: action.leaf, activePaneId: action.leaf.id };
    }

    case "SPLIT": {
      const target = findNode(state.root, action.targetId);
      if (!target) return state;

      const parent = findParent(state.root, action.targetId);
      if (parent && parent.direction === action.direction) {
        const nextChildren = [...parent.children, action.newLeaf];
        const nextRoot = replaceNode(
          state.root,
          (n) => n.id === parent.id,
          () => ({ ...parent, children: nextChildren, sizes: evenSizes(nextChildren.length) }),
        );
        return { ...state, root: nextRoot, activePaneId: action.newLeaf.id };
      }

      const splitNode: SplitPane = {
        type: "split",
        id: crypto.randomUUID(),
        direction: action.direction,
        sizes: evenSizes(2),
        children: [target, action.newLeaf],
      };
      const nextRoot =
        target.id === state.root?.id
          ? splitNode
          : replaceNode(state.root, (n) => n.id === action.targetId, () => splitNode);
      return { ...state, root: nextRoot, activePaneId: action.newLeaf.id };
    }

    case "CLOSE": {
      const wasActive = state.activePaneId === action.id;
      const nextRoot = state.root?.id === action.id ? null : replaceNode(state.root, (n) => n.id === action.id, () => null);
      const nextActive = wasActive ? (collectLeaves(nextRoot)[0]?.id ?? null) : state.activePaneId;
      return { ...state, root: nextRoot, activePaneId: nextActive };
    }

    case "RESIZE": {
      const nextRoot = replaceNode(
        state.root,
        (n) => n.id === action.splitId,
        (n) => ({ ...(n as SplitPane), sizes: action.sizes }),
      );
      return { ...state, root: nextRoot };
    }

    case "FOCUS":
      return { ...state, activePaneId: action.id };

    case "RENAME": {
      const nextRoot = replaceNode(
        state.root,
        (n) => n.id === action.id,
        (n) => ({ ...(n as LeafPane), title: action.title }),
      );
      return { ...state, root: nextRoot };
    }

    case "LOAD_FLOW": {
      if (action.leaves.length === 0) return state;
      if (action.leaves.length === 1) {
        return { ...state, root: action.leaves[0]!, activePaneId: action.leaves[0]!.id };
      }
      const root: SplitPane = {
        type: "split",
        id: crypto.randomUUID(),
        direction: "row",
        sizes: evenSizes(action.leaves.length),
        children: action.leaves,
      };
      return { ...state, root, activePaneId: action.leaves[0]!.id };
    }
    case "SWAP_PANES": {
      const node1 = findNode(state.root, action.id1);
      const node2 = findNode(state.root, action.id2);
      if (!node1 || !node2 || node1.type !== "leaf" || node2.type !== "leaf") return state;

      const nextRoot = replaceNode(
        state.root,
        (n) => n.id === action.id1 || n.id === action.id2,
        (n) => (n.id === action.id1 ? node2 : node1)
      );
      return { ...state, root: nextRoot };
    }

    case "ARRANGE": {
      const leaves = collectLeaves(state.root);
      if (leaves.length === 0) return state;
      return { ...state, root: buildArrangedRoot(action.layout, leaves) };
    }

    case "SET_VIEW_MODE":
      return { ...state, viewMode: action.mode };

    case "SET_CANVAS_POSITIONS": {
      let root = state.root;
      for (const { id, position } of action.positions) {
        root = replaceNode(
          root,
          (n) => n.id === id,
          (n) => ({ ...(n as LeafPane), canvasPosition: position }),
        );
      }
      return { ...state, root };
    }

    default:
      return state;
  }
}

function findParent(root: PaneNode | null, childId: string): SplitPane | null {
  if (!root || root.type !== "split") return null;
  if (root.children.some((c) => c.id === childId)) return root;
  for (const child of root.children) {
    const found = findParent(child, childId);
    if (found) return found;
  }
  return null;
}
