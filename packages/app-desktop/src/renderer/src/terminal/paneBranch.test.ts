import { describe, expect, it } from "vitest";
import { branchForCwd, type Checkout } from "./paneBranch.js";

const checkouts: Checkout[] = [
  { path: "/work/app", branch: "main", detached: false },
  { path: "/work/app/.claude/worktrees/feat-x", branch: "feat/x", detached: false },
  { path: "/work/app/.claude/worktrees/old", detached: true },
];

describe("branchForCwd", () => {
  it("finds the branch of the checkout itself and of a folder inside it", () => {
    expect(branchForCwd(checkouts, "/work/app")).toBe("main");
    expect(branchForCwd(checkouts, "/work/app/packages/ui")).toBe("main");
  });

  it("prefers the deepest checkout, so a worktree inside the repo wins", () => {
    expect(branchForCwd(checkouts, "/work/app/.claude/worktrees/feat-x")).toBe("feat/x");
    expect(branchForCwd(checkouts, "/work/app/.claude/worktrees/feat-x/src")).toBe("feat/x");
  });

  it("labels a detached HEAD", () => {
    expect(branchForCwd(checkouts, "/work/app/.claude/worktrees/old")).toBe("(detached)");
  });

  it("does not match a sibling folder that merely shares a prefix", () => {
    expect(branchForCwd(checkouts, "/work/app-other")).toBeUndefined();
  });

  it("handles Windows separators and trailing slashes", () => {
    const win: Checkout[] = [{ path: "C:\\work\\app", branch: "dev", detached: false }];
    expect(branchForCwd(win, "C:/work/app/src/")).toBe("dev");
  });

  it("is undefined without a cwd or outside any checkout", () => {
    expect(branchForCwd(checkouts, undefined)).toBeUndefined();
    expect(branchForCwd(checkouts, "/elsewhere")).toBeUndefined();
  });
});
