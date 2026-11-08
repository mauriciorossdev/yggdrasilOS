import { describe, expect, it } from "vitest";
import type { TerminalPaneSummary } from "../terminal/terminalPanesStore.js";
import { addPidPanes, panesByWorktree } from "./panes.js";

const pane = (id: string, cwd?: string): TerminalPaneSummary => ({ id, title: id, cwd, minimized: false, docked: false });

describe("panesByWorktree", () => {
  const main = "/p/repo";
  const wt = "/p/repo/.yggdrasil/worktrees/a";

  it("gives each pane to the deepest worktree containing it", () => {
    const m = panesByWorktree([pane("1", main), pane("2", wt), pane("3", `${wt}/src`)], [main, wt]);
    expect(m.get(main)!.map((p) => p.id)).toEqual(["1"]);
    expect(m.get(wt)!.map((p) => p.id)).toEqual(["2", "3"]);
  });
  it("links Windows panes whatever the separators and case", () => {
    const m = panesByWorktree([pane("1", "C:\\Repo\\.yggdrasil\\worktrees\\a\\src")], ["c:/repo", "c:/repo/.yggdrasil/worktrees/a"]);
    expect(m.get("c:/repo/.yggdrasil/worktrees/a")!.map((p) => p.id)).toEqual(["1"]);
    expect(m.get("c:/repo")).toEqual([]);
  });
  it("ignores panes without a folder or outside every worktree, and prefix lookalikes", () => {
    const m = panesByWorktree([pane("1"), pane("2", "/elsewhere"), pane("3", "/p/repo-docs")], [main]);
    expect(m.get(main)).toEqual([]);
  });
});

describe("addPidPanes", () => {
  const wt = "/p/repo/.claude/worktrees/a";
  it("adds the pane behind a Claude lock, once, without moving it off its folder match", () => {
    const front = pane("1", wt);
    const root = pane("2", "/p/repo");
    const byCwd = panesByWorktree([front, root], ["/p/repo", wt]);
    const merged = addPidPanes(byCwd, { [wt]: "2" }, [front, root]);
    expect(merged.get(wt)!.map((p) => p.id)).toEqual(["1", "2"]);
    expect(addPidPanes(merged, { [wt]: "2" }, [front, root]).get(wt)!.map((p) => p.id)).toEqual(["1", "2"]);
  });
  it("ignores a pid pane that is no longer open", () => {
    expect(addPidPanes(new Map([[wt, []]]), { [wt]: "gone" }, []).get(wt)).toEqual([]);
  });
});
