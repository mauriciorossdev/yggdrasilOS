import { describe, expect, it } from "vitest";
import { worktreeDisplayPath, worktreeRepoParam } from "./paths.js";

describe("worktreeRepoParam", () => {
  it("is relative to the project root, '.' for the root itself", () => {
    expect(worktreeRepoParam("/p/repo", "/p/repo")).toBe(".");
    expect(worktreeRepoParam("/p/repo/", "/p/repo/.yggdrasil/worktrees/a")).toBe(".yggdrasil/worktrees/a");
  });
  it("is null outside the root, including a sibling that merely shares the prefix", () => {
    expect(worktreeRepoParam("/p/repo", "/p/repo-docs")).toBeNull();
    expect(worktreeRepoParam("/p/repo", "/elsewhere/a")).toBeNull();
  });
  it("understands Windows separators", () => {
    expect(worktreeRepoParam("C:\\p\\repo", "C:\\p\\repo\\.claude\\worktrees\\a")).toBe(".claude/worktrees/a");
  });
  it("matches Windows paths whatever the separators and the case of the drive and folders", () => {
    expect(worktreeRepoParam("C:\\Users\\Me\\repo", "c:/users/me/repo/.yggdrasil/worktrees/a")).toBe(".yggdrasil/worktrees/a");
    expect(worktreeRepoParam("C:/Users/me/repo", "C:\\Users\\me\\repo")).toBe(".");
    expect(worktreeRepoParam("C:/Users/me/repo", "C:/Users/me/repo-docs")).toBeNull();
    expect(worktreeRepoParam("D:/x", "C:/x/a")).toBeNull();
  });
  it("keeps POSIX paths case-sensitive", () => {
    expect(worktreeRepoParam("/p/repo", "/p/Repo/a")).toBeNull();
  });
  it("displays the full path when outside the project", () => {
    expect(worktreeDisplayPath("/p/repo", "/p/repo-docs")).toBe("/p/repo-docs");
  });
});
