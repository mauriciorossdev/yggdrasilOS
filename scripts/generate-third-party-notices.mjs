#!/usr/bin/env node
// Generates THIRD_PARTY_NOTICES.md from what actually ships in the desktop
// installer: app-desktop's production dependencies plus every package its
// source imports (the renderer is bundled by Vite from devDependencies, so
// those end up in the app too). Run `pnpm notices`; the release workflow runs
// it right before packaging so the file in the installer is never stale.
//
//   --check    exit 1 if the committed file differs from a fresh generation
//   --strict   exit 1 if any package has no declared license
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectClosure, extractImportedPackages, reconstructLicenseText, renderNotices } from "./lib/notices.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDir = path.join(repoRoot, "packages", "app-desktop");
const outFile = path.join(repoRoot, "THIRD_PARTY_NOTICES.md");
const args = new Set(process.argv.slice(2));

function listSourceFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listSourceFiles(full));
    else if (/\.(ts|tsx|mjs|cjs|js)$/.test(entry.name) && !/\.test\.[tj]sx?$/.test(entry.name)) files.push(full);
  }
  return files;
}

const appPkg = JSON.parse(fs.readFileSync(path.join(appDir, "package.json"), "utf8"));
const declared = new Set([...Object.keys(appPkg.dependencies ?? {}), ...Object.keys(appPkg.devDependencies ?? {})]);

const sources = listSourceFiles(path.join(appDir, "src")).map((f) => fs.readFileSync(f, "utf8"));
// `electron` is imported as a built-in module; its runtime ships with its own
// notices (LICENSE.electron.txt, LICENSES.chromium.html), not as an npm package.
const PROVIDED_BY_RUNTIME = new Set(["electron"]);
const imported = extractImportedPackages(sources, (name) => declared.has(name) && !PROVIDED_BY_RUNTIME.has(name));
const roots = [...new Set([...Object.keys(appPkg.dependencies ?? {}), ...imported])].sort();

const { entries, missing } = collectClosure({ rootDir: appDir, roots });
const content = renderNotices(entries) + "\n";

const unknown = entries.filter((e) => e.license === "UNKNOWN");
const noText = entries.filter((e) => !e.text && !reconstructLicenseText(e));
console.log(`${entries.length} packages (${roots.length} roots, ${imported.size} from source imports)`);
if (missing.length) console.warn(`not installed, skipped: ${missing.join("; ")}`);
if (noText.length) console.warn(`no license text and no template: ${noText.map((e) => `${e.name}@${e.version}`).join(", ")}`);
if (unknown.length) console.warn(`UNKNOWN license: ${unknown.map((e) => `${e.name}@${e.version}`).join(", ")}`);

if (args.has("--check")) {
  const current = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8").replace(/\r\n/g, "\n") : "";
  if (current !== content) {
    console.error("THIRD_PARTY_NOTICES.md is out of date — run `pnpm notices`.");
    process.exit(1);
  }
  console.log("THIRD_PARTY_NOTICES.md is up to date.");
} else {
  fs.writeFileSync(outFile, content, "utf8");
  console.log(`wrote ${path.relative(repoRoot, outFile)}`);
}

if (args.has("--strict") && unknown.length) process.exit(1);
