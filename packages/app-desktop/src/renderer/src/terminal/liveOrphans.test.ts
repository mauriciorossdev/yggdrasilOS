import { describe, expect, it } from "vitest";
import { liveOrphans } from "./liveOrphans.js";
import { collectLeaves, paneReducer, type LeafPane } from "./paneTree.js";

const leaf = (id: string): LeafPane => ({ type: "leaf", id, title: id, cwd: "/p" });
const live = (id: string) => ({ id, title: `T-${id}`, cwd: "/p", createdAt: 0, command: "claude" });

describe("liveOrphans", () => {
  it("returns only live panes without a leaf, as attach leaves", () => {
    const res = liveOrphans([leaf("a")], [live("a"), live("b")]);
    expect(res).toEqual([{ type: "leaf", id: "b", title: "T-b", cwd: "/p", command: "claude", attach: true }]);
  });
});

describe("ADOPT_LIVE", () => {
  it("builds a root from nothing", () => {
    const state = paneReducer({ root: null, activePaneId: null }, { type: "ADOPT_LIVE", leaves: [leaf("a"), leaf("b")] });
    expect(collectLeaves(state.root).map((l) => l.id)).toEqual(["a", "b"]);
    expect(state.activePaneId).toBe("a");
  });

  it("adds missing leaves, ignores known and duplicate ids, keeps the active pane", () => {
    const start = { root: leaf("a"), activePaneId: "a" };
    const state = paneReducer(start, { type: "ADOPT_LIVE", leaves: [leaf("a"), leaf("b"), leaf("b")] });
    expect(collectLeaves(state.root).map((l) => l.id)).toEqual(["a", "b"]);
    expect(state.activePaneId).toBe("a");
  });

  it("is a no-op when everything is already shown", () => {
    const start = { root: leaf("a"), activePaneId: "a" };
    expect(paneReducer(start, { type: "ADOPT_LIVE", leaves: [leaf("a")] })).toBe(start);
  });
});
