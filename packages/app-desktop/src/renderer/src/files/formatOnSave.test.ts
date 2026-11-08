import { describe, expect, it } from "vitest";
import { formatForSave } from "./formatOnSave.js";

describe("formatForSave", () => {
  it("returns the formatted text", async () => {
    let text = "a  =  1";
    const out = await formatForSave({ getValue: () => text, format: async () => void (text = "a = 1") }, "a  =  1");
    expect(out).toBe("a = 1");
  });

  it("keeps the text when there's no formatter", async () => {
    expect(await formatForSave({ getValue: () => "x" }, "x")).toBe("x");
  });

  it("doesn't format when the editor shows different text", async () => {
    let called = false;
    const out = await formatForSave({ getValue: () => "other", format: async () => void (called = true) }, "mine");
    expect(out).toBe("mine");
    expect(called).toBe(false);
  });

  it("still saves when the formatter fails or hangs", async () => {
    expect(await formatForSave({ getValue: () => "x", format: () => Promise.reject(new Error("no")) }, "x")).toBe("x");
    expect(await formatForSave({ getValue: () => "x", format: () => new Promise(() => {}) }, "x", 5)).toBe("x");
  });
});
