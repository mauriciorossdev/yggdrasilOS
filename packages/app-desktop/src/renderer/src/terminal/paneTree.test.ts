import { describe, expect, it } from "vitest";
import { collectLeaves, newLeaf, paneReducer, SCRIPT_PANE_PREFIX } from "./paneTree.js";

describe("paneReducer HYDRATE", () => {
  it("does not restore a package.json script's pane (a dev server must not start by itself)", () => {
    const shell = { ...newLeaf("/p", "Terminal 1"), id: "shell-1" };
    const script = { ...newLeaf("/p", "pnpm run dev"), id: `${SCRIPT_PANE_PREFIX}abc`, command: "pnpm", args: ["run", "dev"] };
    const state = paneReducer(
      { root: null, activePaneId: null, viewMode: "grid" },
      {
        type: "HYDRATE",
        layout: {
          root: { type: "split", id: "s", direction: "row", sizes: [1, 1], children: [shell, script] },
          activePaneId: script.id,
          viewMode: "grid",
        },
      },
    );
    expect(collectLeaves(state.root).map((l) => l.id)).toEqual(["shell-1"]);
    expect(state.activePaneId).toBe("shell-1");
  });
});
