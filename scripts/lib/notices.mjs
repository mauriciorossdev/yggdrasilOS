// Pure helpers for scripts/generate-third-party-notices.mjs. Kept separate so
// they can be unit-tested against a throwaway node_modules layout.
import fs from "node:fs";
import path from "node:path";

/** SPDX-ish license string from a package.json, tolerating the legacy `{type}` and `licenses[]` forms. */
export function normalizeLicense(pkg) {
  if (typeof pkg.license === "string" && pkg.license) return pkg.license;
  if (pkg.license && typeof pkg.license.type === "string") return pkg.license.type;
  if (Array.isArray(pkg.licenses)) {
    const ids = pkg.licenses.map((l) => (typeof l === "string" ? l : l?.type)).filter(Boolean);
    if (ids.length === 1) return ids[0];
    if (ids.length > 1) return `(${ids.join(" OR ")})`;
  }
  return "UNKNOWN";
}

// LICENSE, LICENCE, COPYING (+ optional suffix/extension); NOTICE is included too because Apache-2.0 requires carrying it.
const LICENSE_FILE_RE = /^(licen[sc]e|copying|notice)([-._][^/\\]*)?$/i;
const FILE_ORDER = (name) => (/^notice/i.test(name) ? 1 : 0);

/** Text of a package's license (and NOTICE) files, or null when it ships none. */
export function readLicenseText(dir) {
  let names;
  try {
    names = fs.readdirSync(dir).filter((n) => LICENSE_FILE_RE.test(n));
  } catch {
    return null;
  }
  names = names.filter((n) => fs.statSync(path.join(dir, n)).isFile()).sort((a, b) => FILE_ORDER(a) - FILE_ORDER(b) || a.localeCompare(b));
  if (names.length === 0) return null;
  return names
    .map((n) => fs.readFileSync(path.join(dir, n), "utf8").replace(/\r\n/g, "\n").trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Finds where `name` resolves to when required from `fromDir`, the way Node
 * does, plus pnpm's layout where a package's dependencies are *siblings* of it
 * inside `.pnpm/<pkg>/node_modules/`.
 */
export function resolveDependency(fromDir, name) {
  let cur = fromDir;
  for (;;) {
    const candidates = [path.join(cur, "node_modules", name)];
    if (path.basename(cur) === "node_modules") candidates.push(path.join(cur, name));
    for (const c of candidates) {
      if (fs.existsSync(path.join(c, "package.json"))) return c;
    }
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

/** `@scope/pkg/deep/path?worker` → `@scope/pkg`; relative paths and node: builtins → null. */
export function packageNameFromSpecifier(spec) {
  if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("node:")) return null;
  const clean = spec.split("?")[0];
  const parts = clean.split("/");
  if (clean.startsWith("@")) return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  return parts[0] || null;
}

const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;

/** Package names imported by `sources` (file contents), limited to names `isKnown` accepts. */
export function extractImportedPackages(sources, isKnown) {
  const found = new Set();
  for (const text of sources) {
    for (const m of text.matchAll(IMPORT_RE)) {
      const name = packageNameFromSpecifier(m[1]);
      if (name && isKnown(name)) found.add(name);
    }
  }
  return found;
}

function readPackageJson(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
}

const isThirdParty = (realDir) => realDir.split(path.sep).includes("node_modules");

function authorName(pkg) {
  const a = pkg.author;
  const raw = typeof a === "string" ? a : a?.name;
  // "Name <mail> (url)" → "Name"
  return raw ? raw.replace(/\s*[<(].*$/, "").trim() || null : null;
}

function repositoryUrl(pkg) {
  const repo = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  if (repo) {
    return repo
      .replace(/^git\+/, "")
      .replace(/^git:\/\//, "https://")
      .replace(/^ssh:\/\/git@/, "https://")
      .replace(/\.git$/, "");
  }
  return pkg.homepage ?? null;
}

/**
 * Walks the dependency closure of `roots` (resolved from `rootDir`) and
 * returns every third-party package in it. Workspace packages are traversed
 * (their own dependencies ship) but not listed — they're this project's code.
 * `devDependencies` are never followed: only what ends up in the installer.
 */
export function collectClosure({ rootDir, roots }) {
  const seen = new Set();
  const entries = [];
  const missing = [];

  const visit = (dir, requiredBy) => {
    const real = fs.realpathSync(dir);
    if (seen.has(real)) return;
    seen.add(real);
    const pkg = readPackageJson(real);

    if (isThirdParty(real)) {
      entries.push({
        name: pkg.name,
        version: pkg.version,
        license: normalizeLicense(pkg),
        source: repositoryUrl(pkg),
        author: authorName(pkg),
        text: readLicenseText(real),
      });
    }

    const optional = new Set(Object.keys(pkg.optionalDependencies ?? {}));
    for (const dep of [...Object.keys(pkg.dependencies ?? {}), ...optional]) {
      const found = resolveDependency(real, dep);
      if (found) visit(found, pkg.name);
      else if (!optional.has(dep)) missing.push(`${dep} (required by ${pkg.name})`);
    }
  };

  for (const root of roots) {
    const found = resolveDependency(rootDir, root);
    if (found) visit(found, "app-desktop");
    else missing.push(`${root} (root)`);
  }

  entries.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  return { entries, missing };
}

/** Non-npm components that ship in the installer; they have no package.json to read. */
export const EXTRA_COMPONENTS = [
  "**Electron and Chromium** — the packaged app carries their notices as `LICENSE.electron.txt` and `LICENSES.chromium.html` next to the executable.",
  "**SQLite** (compiled into `better-sqlite3`) — public domain.",
];

const MIT_TEMPLATE = `MIT License

Copyright (c) {holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

const ISC_TEMPLATE = `ISC License

Copyright (c) {holder}

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.`;

const TEMPLATES = { MIT: MIT_TEMPLATE, ISC: ISC_TEMPLATE };

/**
 * For a package that declares MIT or ISC but ships no LICENSE file, the
 * standard text with the copyright holder taken from its package.json
 * (`author`, else "the <name> contributors"). Returns null for anything else.
 */
export function reconstructLicenseText(entry) {
  const template = TEMPLATES[entry.license];
  if (!template) return null;
  return template.replace("{holder}", entry.author ?? `the ${entry.name} contributors`);
}

export function renderNotices(entries, { projectLicenseNote } = {}) {
  const counts = new Map();
  for (const e of entries) counts.set(e.license, (counts.get(e.license) ?? 0) + 1);
  const summary = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const out = [];
  out.push("# Third-party notices", "");
  out.push(
    projectLicenseNote ??
      "Yggdrasil is released under the MIT License (see `LICENSE`). The desktop app ships the open-source packages listed below, each under its own license. This file is generated by `pnpm notices` from the packages that actually go into the installer — do not edit it by hand.",
    "",
  );
  out.push("Models and voices downloaded at runtime (Whisper, Piper) and the agent CLIs a user installs themselves (Claude Code, Copilot, Antigravity, omp) are **not** part of this distribution and are not covered here.", "");
  out.push("## Other components", "", ...EXTRA_COMPONENTS.map((c) => `- ${c}`), "");
  out.push("## Summary", "", "| License | Packages |", "|---|---|");
  for (const [license, n] of summary) out.push(`| ${license} | ${n} |`);
  out.push("", "## Packages", "");

  for (const e of entries) {
    out.push(`### ${e.name}@${e.version}`, "");
    out.push(`License: ${e.license}${e.source ? ` · ${e.source}` : ""}`, "");
    const rebuilt = e.text ? null : reconstructLicenseText(e);
    if (e.text) out.push("~~~~", e.text, "~~~~", "");
    else if (rebuilt) {
      out.push("_The package ships no license file; this is the standard " + e.license + " text with the holder taken from its package.json._", "", "~~~~", rebuilt, "~~~~", "");
    } else out.push("_No license file in the package; see the SPDX identifier above._", "");
  }
  return out.join("\n");
}
