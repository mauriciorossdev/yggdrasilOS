import { describe, expect, it } from "vitest";
import { parseWorktreeOption } from "./worktreeOption.js";

describe("parseWorktreeOption", () => {
  it("takes true as 'derive the name'", () => {
    expect(parseWorktreeOption(true)).toBe(true);
  });
  it("reads the words true/false (any case) as booleans, not as names", () => {
    expect(parseWorktreeOption("true")).toBe(true);
    expect(parseWorktreeOption(" True ")).toBe(true);
    expect(parseWorktreeOption("false")).toBeUndefined();
    expect(parseWorktreeOption("FALSE")).toBeUndefined();
  });
  it("keeps any other string as the worktree name", () => {
    expect(parseWorktreeOption(" my-name ")).toBe("my-name");
  });
  it("ignores the rest", () => {
    for (const v of [false, undefined, null, "", "  ", 1, {}]) expect(parseWorktreeOption(v)).toBeUndefined();
  });
});
