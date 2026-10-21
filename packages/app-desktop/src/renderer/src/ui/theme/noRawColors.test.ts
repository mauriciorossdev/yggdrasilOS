import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Raw hex colors left in styles.css from before the token migration. This
// budget only ever goes DOWN: new styles must use the --ygg-* tokens from
// tokens.css (or add a token there), and each cleanup pass lowers the number.
const STYLES_HEX_BUDGET = 2;

describe("design tokens", () => {
  it("keeps raw hex colors in styles.css within the shrinking budget", () => {
    const css = readFileSync(fileURLToPath(new URL("../../styles.css", import.meta.url)), "utf8");
    const hex = css.match(/#[0-9a-fA-F]{3,8}(?![0-9a-fA-F])/g) ?? [];
    expect(hex.length).toBeLessThanOrEqual(STYLES_HEX_BUDGET);
  });

  it("defines the four editable core colors", () => {
    const tokens = readFileSync(fileURLToPath(new URL("./tokens.css", import.meta.url)), "utf8");
    for (const name of ["--ygg-bg", "--ygg-surface", "--ygg-text", "--ygg-accent"]) {
      expect(tokens).toMatch(new RegExp(name + ":[ ]*#[0-9a-fA-F]{6}"));
    }
  });
});
