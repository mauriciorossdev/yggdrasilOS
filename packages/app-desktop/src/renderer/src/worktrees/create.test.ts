import { describe, expect, it } from "vitest";
import { MAX_FANOUT, cleanGatewayError, planWorktrees, slugifyWorktreeName } from "./create.js";

describe("planWorktrees", () => {
  it("keeps the name for one worktree and suffixes a fan-out", () => {
    expect(planWorktrees(" front ", 1)).toEqual(["front"]);
    expect(planWorktrees("eval", 3)).toEqual(["eval-a", "eval-b", "eval-c"]);
  });
  it("clamps the count", () => {
    expect(planWorktrees("x", 0)).toEqual(["x"]);
    expect(planWorktrees("x", Number.NaN)).toEqual(["x"]);
    expect(planWorktrees("x", 99)).toHaveLength(MAX_FANOUT);
  });
});

describe("cleanGatewayError", () => {
  it("drops the error code and method prefixes", () => {
    expect(cleanGatewayError("INTERNAL_ERROR: git.worktreeAdd: .yggdrasil/worktrees/a already exists")).toBe(
      ".yggdrasil/worktrees/a already exists",
    );
    expect(cleanGatewayError("plain message")).toBe("plain message");
  });
});

describe("slugifyWorktreeName", () => {
  it("turns a node name into a valid slug, or nothing", () => {
    expect(slugifyWorktreeName("Front end — login")).toBe("front-end-login");
    expect(slugifyWorktreeName("  ///  ")).toBe("");
    expect(slugifyWorktreeName("a..b")).toBe("a.b");
    expect(slugifyWorktreeName("x.lock")).toBe("x");
  });
});
