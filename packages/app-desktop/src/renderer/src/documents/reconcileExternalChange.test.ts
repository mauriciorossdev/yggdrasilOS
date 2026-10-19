import { describe, expect, it } from "vitest";
import { reconcileExternalChange } from "./reconcileExternalChange.js";

describe("reconcileExternalChange", () => {
  it("ignores the echo of our own save / an unchanged file", () => {
    expect(reconcileExternalChange({ content: "a", savedContent: "a" }, "a")).toBe("noop");
    expect(reconcileExternalChange({ content: "b", savedContent: "a" }, "a")).toBe("noop");
  });

  it("ignores a save whose echo arrives before savedContent is updated", () => {
    expect(reconcileExternalChange({ content: "b", savedContent: "a" }, "b")).toBe("noop");
  });

  it("reloads a clean tab when the file changed on disk", () => {
    expect(reconcileExternalChange({ content: "a", savedContent: "a" }, "agent edit")).toBe("reload");
  });

  it("flags a conflict instead of clobbering unsaved edits", () => {
    expect(reconcileExternalChange({ content: "mine", savedContent: "a" }, "agent edit")).toBe("conflict");
  });
});
