import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error plain ESM script helpers, no type declarations
import * as notices from "../scripts/lib/notices.mjs";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "notices-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function writePkg(dir: string, pkg: Record<string, unknown>, files: Record<string, string> = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
}

describe("normalizeLicense", () => {
  it("handles string, legacy object and legacy array forms", () => {
    expect(notices.normalizeLicense({ license: "MIT" })).toBe("MIT");
    expect(notices.normalizeLicense({ license: { type: "ISC" } })).toBe("ISC");
    expect(notices.normalizeLicense({ licenses: [{ type: "MIT" }] })).toBe("MIT");
    expect(notices.normalizeLicense({ licenses: [{ type: "MIT" }, { type: "Apache-2.0" }] })).toBe("(MIT OR Apache-2.0)");
    expect(notices.normalizeLicense({})).toBe("UNKNOWN");
  });
});

describe("packageNameFromSpecifier", () => {
  it("extracts the package, ignoring paths, queries, relative and builtin specifiers", () => {
    expect(notices.packageNameFromSpecifier("react")).toBe("react");
    expect(notices.packageNameFromSpecifier("@xyflow/react/dist/style.css")).toBe("@xyflow/react");
    expect(notices.packageNameFromSpecifier("monaco-editor/editor/editor.worker?worker")).toBe("monaco-editor");
    expect(notices.packageNameFromSpecifier("./local")).toBeNull();
    expect(notices.packageNameFromSpecifier("../up")).toBeNull();
    expect(notices.packageNameFromSpecifier("node:fs")).toBeNull();
  });
});

describe("extractImportedPackages", () => {
  it("finds import/from/dynamic import/require and keeps only known packages", () => {
    const src = [
      `import React from "react";\nimport "./x.css";\nimport type { A } from "@scope/known/sub";`,
      `const m = await import("lazy-lib");\nconst c = require("cjs-lib");\nimport fs from "node:fs";`,
      `import nope from "not-declared";`,
    ];
    const known = new Set(["react", "@scope/known", "lazy-lib", "cjs-lib"]);
    expect([...notices.extractImportedPackages(src, (n: string) => known.has(n))].sort()).toEqual([
      "@scope/known",
      "cjs-lib",
      "lazy-lib",
      "react",
    ]);
  });
});

describe("readLicenseText", () => {
  it("reads LICENSE variants plus NOTICE, normalizing line endings, and returns null when absent", () => {
    const dir = path.join(root, "p");
    writePkg(dir, { name: "p" }, { "LICENSE.md": "MIT text\r\nline", NOTICE: "notice text", "README.md": "ignore me" });
    expect(notices.readLicenseText(dir)).toBe("MIT text\nline\n\nnotice text");
    writePkg(path.join(root, "q"), { name: "q" });
    expect(notices.readLicenseText(path.join(root, "q"))).toBeNull();
  });
});

describe("resolveDependency", () => {
  it("resolves nested node_modules and pnpm-style sibling packages", () => {
    // npm-style
    writePkg(path.join(root, "a", "node_modules", "dep"), { name: "dep" });
    expect(notices.resolveDependency(path.join(root, "a"), "dep")).toBe(path.join(root, "a", "node_modules", "dep"));
    // pnpm-style: .pnpm/x@1/node_modules/{x,dep}
    const store = path.join(root, "store", "node_modules", ".pnpm", "x@1", "node_modules");
    writePkg(path.join(store, "x"), { name: "x" });
    writePkg(path.join(store, "dep"), { name: "dep" });
    expect(notices.resolveDependency(path.join(store, "x"), "dep")).toBe(path.join(store, "dep"));
    expect(notices.resolveDependency(path.join(store, "x"), "missing")).toBeNull();
  });
});

describe("collectClosure", () => {
  it("lists third-party packages in the closure, skips devDependencies, tolerates missing optionals", () => {
    const nm = path.join(root, "app", "node_modules");
    writePkg(path.join(root, "app"), { name: "app" });
    writePkg(path.join(nm, "lib"), { name: "lib", version: "1.0.0", license: "MIT", author: "Ada <a@b.c> (https://x)", dependencies: { child: "^1" }, devDependencies: { devonly: "1" }, optionalDependencies: { absent: "1" } }, { LICENSE: "lib license" });
    writePkg(path.join(nm, "child"), { name: "child", version: "2.0.0", license: "ISC" });
    writePkg(path.join(nm, "devonly"), { name: "devonly", version: "1.0.0", license: "MIT" });

    const { entries, missing } = notices.collectClosure({ rootDir: path.join(root, "app"), roots: ["lib"] });
    expect(entries.map((e: { name: string }) => e.name)).toEqual(["child", "lib"]);
    expect(entries[1]).toMatchObject({ license: "MIT", author: "Ada", text: "lib license" });
    expect(entries[0].text).toBeNull();
    expect(missing).toEqual([]);
  });

  it("reports a missing required dependency and an unresolvable root", () => {
    const nm = path.join(root, "app", "node_modules");
    writePkg(path.join(root, "app"), { name: "app" });
    writePkg(path.join(nm, "lib"), { name: "lib", version: "1.0.0", license: "MIT", dependencies: { gone: "1" } });
    const { missing } = notices.collectClosure({ rootDir: path.join(root, "app"), roots: ["lib", "nowhere"] });
    expect(missing).toEqual(["gone (required by lib)", "nowhere (root)"]);
  });

  it("walks through workspace packages (outside node_modules) without listing them", () => {
    const ws = path.join(root, "packages", "shared");
    writePkg(ws, { name: "shared", version: "0.1.0", license: "MIT", dependencies: { third: "1" } });
    writePkg(path.join(ws, "node_modules", "third"), { name: "third", version: "3.0.0", license: "MIT" });
    writePkg(path.join(root, "app"), { name: "app" });
    fs.mkdirSync(path.join(root, "app", "node_modules"), { recursive: true });
    fs.symlinkSync(ws, path.join(root, "app", "node_modules", "shared"), "junction");

    const { entries } = notices.collectClosure({ rootDir: path.join(root, "app"), roots: ["shared"] });
    expect(entries.map((e: { name: string }) => e.name)).toEqual(["third"]);
  });
});

describe("reconstructLicenseText / renderNotices", () => {
  it("rebuilds MIT and ISC text with the author, and nothing for other licenses", () => {
    const mit = notices.reconstructLicenseText({ name: "p", license: "MIT", author: "Ada" });
    expect(mit).toContain("Copyright (c) Ada");
    expect(mit).toContain("Permission is hereby granted");
    expect(notices.reconstructLicenseText({ name: "p", license: "MIT" })).toContain("Copyright (c) the p contributors");
    expect(notices.reconstructLicenseText({ name: "p", license: "ISC", author: "Bo" })).toContain("Copyright (c) Bo");
    expect(notices.reconstructLicenseText({ name: "p", license: "Apache-2.0" })).toBeNull();
  });

  it("renders a summary and every package, marking reconstructed and missing texts", () => {
    const out = notices.renderNotices([
      { name: "a", version: "1.0.0", license: "MIT", source: "https://x/a", author: null, text: "A TEXT" },
      { name: "b", version: "2.0.0", license: "MIT", source: null, author: "Bo", text: null },
      { name: "c", version: "3.0.0", license: "Apache-2.0", source: null, author: null, text: null },
    ]);
    expect(out).toContain("| MIT | 2 |");
    expect(out).toContain("| Apache-2.0 | 1 |");
    expect(out).toContain("### a@1.0.0");
    expect(out).toContain("A TEXT");
    expect(out).toContain("ships no license file");
    expect(out).toContain("No license file in the package");
  });
});
