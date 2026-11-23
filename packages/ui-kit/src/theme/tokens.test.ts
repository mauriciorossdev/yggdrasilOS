import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("design tokens", () => {
  it("defines the four editable core colors", () => {
    const tokens = readFileSync(fileURLToPath(new URL("./tokens.css", import.meta.url)), "utf8");
    for (const name of ["--ygg-bg", "--ygg-surface", "--ygg-text", "--ygg-accent"]) {
      expect(tokens).toMatch(new RegExp(name + ":[ ]*#[0-9a-fA-F]{6}"));
    }
  });
});
