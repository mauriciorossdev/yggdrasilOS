import { describe, expect, it } from "vitest";
import {
  buildClickScript,
  buildReadScript,
  buildTypeScript,
  clampMaxChars,
  DEFAULT_READ_MAX_CHARS,
  MAX_READ_MAX_CHARS,
} from "./browserPageScripts.js";

// No DOM in this test environment, so the scripts can only be checked for
// being valid JavaScript and for embedding their inputs safely.
function parses(script: string): boolean {
  try {
    new Function(`return ${script};`);
    return true;
  } catch {
    return false;
  }
}

describe("clampMaxChars", () => {
  it("defaults for missing or invalid values", () => {
    expect(clampMaxChars(undefined)).toBe(DEFAULT_READ_MAX_CHARS);
    expect(clampMaxChars(0)).toBe(DEFAULT_READ_MAX_CHARS);
    expect(clampMaxChars(-5)).toBe(DEFAULT_READ_MAX_CHARS);
    expect(clampMaxChars(Number.NaN)).toBe(DEFAULT_READ_MAX_CHARS);
    expect(clampMaxChars("100")).toBe(DEFAULT_READ_MAX_CHARS);
  });

  it("caps at the maximum", () => {
    expect(clampMaxChars(500)).toBe(500);
    expect(clampMaxChars(10_000_000)).toBe(MAX_READ_MAX_CHARS);
  });
});

describe("page scripts", () => {
  it("are valid JavaScript", () => {
    expect(parses(buildReadScript(1000))).toBe(true);
    expect(parses(buildClickScript("#go"))).toBe(true);
    expect(parses(buildTypeScript("input[name=q]", "hello", true))).toBe(true);
  });

  it("stay valid and contained when inputs contain quotes, backticks and script terminators", () => {
    const nasty = `"'\`</script>\${alert(1)}\\\n x`;
    expect(parses(buildClickScript(nasty))).toBe(true);
    expect(parses(buildTypeScript(nasty, nasty, false))).toBe(true);
  });

  it("embeds inputs as JSON string literals, not raw code", () => {
    const script = buildTypeScript("#a", `x"); evil(); ("`, false);
    expect(script).toContain(JSON.stringify(`x"); evil(); ("`));
    // A raw (unescaped) occurrence of the payload would mean it escaped its literal.
    expect(script.split(`x"); evil(); ("`).length - 1).toBe(0);
  });
});
