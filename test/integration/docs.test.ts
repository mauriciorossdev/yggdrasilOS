// Keeps the public docs honest: every package is described and listed, and no
// relative link points at a file the public repository does not have.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain script without type declarations
import { readPackages, withPackageMap } from "../../scripts/package-map.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
// Folders the public export leaves out (scripts/oss-sync/config.mjs).
const PRIVATE = ["notes/", "docs/plans/"];

const markdownFiles = execFileSync("git", ["ls-files", "*.md"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter((f) => f && !PRIVATE.some((p) => f.startsWith(p)) && !f.startsWith(".claude/") && f !== "CLAUDE.md")
  // Copies of some guides, shipped as agent context rather than browsed as pages.
  .filter((f) => !f.startsWith("packages/context-system-docs/docs/"));

describe("documentation", () => {
  it("every package has a description", () => {
    const missing = ["packages", "extensions"]
      .flatMap((folder) => readPackages(root, folder) as Array<{ dir: string; description: string }>)
      .filter((p) => !p.description.trim())
      .map((p) => p.dir);
    expect(missing).toEqual([]);
  });

  it("the package map in ARCHITECTURE.md is up to date (pnpm package-map)", () => {
    const current = readFileSync(join(root, "ARCHITECTURE.md"), "utf8").replaceAll("\r\n", "\n");
    expect(current).toBe(withPackageMap(current, root));
  });

  it("relative links resolve in the public repository", () => {
    const broken: string[] = [];
    for (const file of markdownFiles) {
      if (!existsSync(join(root, file))) continue;
      const text = readFileSync(join(root, file), "utf8").replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
      for (const [, target] of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(target)) continue;
        const path = resolve(root, dirname(file), decodeURI(target.split("#")[0]));
        const fromRoot = relative(root, path).split("\\").join("/") + (existsSync(path) && statSync(path).isDirectory() ? "/" : "");
        if (!existsSync(path) || PRIVATE.some((p) => fromRoot.startsWith(p))) broken.push(`${file} -> ${target}`);
      }
    }
    expect(broken).toEqual([]);
  });
});
