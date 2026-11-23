import { describe, expect, it } from "vitest";
import { locateComment } from "./anchor.js";
import { suggestPane } from "./suggestTarget.js";

const file = ["a", "b", "target 1", "target 2", "c", "target 1", "target 2"];

describe("locateComment", () => {
  it("keeps the saved lines while the text is there", () => {
    expect(locateComment({ startLine: 3, endLine: 4, snippet: "target 1\ntarget 2" }, file)).toEqual({ startLine: 3, endLine: 4 });
  });

  it("follows the text when lines moved, to the nearest occurrence", () => {
    expect(locateComment({ startLine: 2, endLine: 3, snippet: "target 1\ntarget 2" }, file)).toEqual({ startLine: 3, endLine: 4 });
    expect(locateComment({ startLine: 7, endLine: 8, snippet: "target 1\ntarget 2" }, file)).toEqual({ startLine: 6, endLine: 7 });
  });

  it("is outdated when the text is gone; trailing spaces don't count", () => {
    expect(locateComment({ startLine: 3, endLine: 3, snippet: "nope" }, file)).toBeNull();
    expect(locateComment({ startLine: 1, endLine: 1, snippet: "a   " }, file)).toEqual({ startLine: 1, endLine: 1 });
  });

  it("without saved text trusts the line numbers while they exist", () => {
    expect(locateComment({ startLine: 7, endLine: 7, snippet: "" }, file)).toEqual({ startLine: 7, endLine: 7 });
    expect(locateComment({ startLine: 9, endLine: 9, snippet: "" }, file)).toBeNull();
  });
});

describe("suggestPane", () => {
  const root = "/p";
  const panes = [
    { id: "wt", title: "wt", cwd: "/p/.yggdrasil/worktrees/x", command: "claude" },
    { id: "shell", title: "shell", cwd: "/p", command: undefined },
    { id: "busy", title: "busy", cwd: "/p", command: "claude" },
    { id: "fresh", title: "fresh", cwd: "/p/src", command: "claude" },
    { id: "other", title: "other", cwd: "/elsewhere", command: "claude" },
  ];

  it("prefers a claude pane in the repo that just finished, then idle, then busy; never a worktree's pane", () => {
    const attention = { busy: { status: "working" as const, since: 5 }, fresh: { status: "done" as const, since: 9 } };
    expect(suggestPane(root, panes, attention)?.id).toBe("fresh");
    expect(suggestPane(root, panes, { busy: { status: "working", since: 5 } })?.id).toBe("fresh");
    expect(suggestPane(root, panes.slice(0, 3), { busy: { status: "working", since: 5 } })?.id).toBe("busy");
    expect(suggestPane("/p/.yggdrasil/worktrees/x", panes, {})?.id).toBe("wt");
    expect(suggestPane("/nowhere", panes, {})).toBeUndefined();
  });
});
