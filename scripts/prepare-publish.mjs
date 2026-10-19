#!/usr/bin/env node
/**
 * Syncs version, publishConfig, repository and engines across all publishable packages.
 * Run from repo root: node scripts/prepare-publish.mjs [--version 0.1.0-beta.1]
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const args = process.argv.slice(2);
const versionArg = args[args.indexOf("--version") + 1];
const VERSION = versionArg ?? "0.1.0-beta.1";
const REPO_URL = "https://github.com/mauriciorossdev/yggdrasilOS.git";

// Core packages (under packages/)
const CORE_PACKAGES = [
  "context-sdk",
  "tools-sdk",
  "skills-sdk",
  "skill-adapter",
  "sdk",
  "config",
  "sessions",
  "context-memory-db",
  "context-memory-local",
  "context-project",
  "context-prompt-files",
  "context-runtime",
  "kernel",
  "harness-runtime",
  "tools-runtime",
  "tool-builtin",
  "pipeline",
  "provider-openai-compat",
  "provider-ollama",
  "harness-llm",
  "gateway",
  "sandbox-runtime",
  "context-system-docs",
  "channel-tui",
  "channel-http",
  "app-tui",
  "cli",
];

// Extensions (under extensions/) — installable via `yggdrasil plugin install`
const EXTENSIONS = [
  "channel-discord",
  "channel-slack",
  "channel-telegram",
  "service-cron",
  "tool-browser",
  "tool-datetime",
  "tool-fetch",
  "tool-fs",
  "tool-image",
  "tool-search",
  "tool-shell",
  // Excluded: echo-channel (dev only), my-tool (scaffold template), tool-destructive-demo (dev only)
];

const root = new URL("..", import.meta.url).pathname;

async function updatePackage(pkgPath, name, subdir) {
  const pkg = JSON.parse(await readFile(pkgPath, "utf8"));

  // NOTE: workspace:* deps are left as-is.
  // pnpm publish -r automatically replaces workspace:* with actual versions when publishing.

  pkg.version = VERSION;
  pkg.publishConfig = { access: "public", registry: "https://registry.npmjs.org" };
  pkg.repository = { type: "git", url: REPO_URL, directory: `${subdir}/${name}` };
  pkg.engines = { node: ">=22" };

  if (!pkg.scripts) pkg.scripts = {};
  if (pkg.scripts.build && !pkg.scripts.prepublishOnly) {
    pkg.scripts.prepublishOnly = "pnpm run build";
  }

  // files field
  if (!pkg.files) {
    if (name === "cli") {
      pkg.files = ["dist", "templates"];
    } else {
      pkg.files = ["dist"];
    }
  }
  // extensions need yggdrasil.plugin.json
  if (subdir === "extensions") {
    if (!pkg.files.includes("yggdrasil.plugin.json")) {
      pkg.files.push("yggdrasil.plugin.json");
    }
  }

  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  console.log(`✓ ${subdir}/${name} → ${VERSION}`);
}

console.log(`\nPreparing publish @ ${VERSION}\n`);

for (const name of CORE_PACKAGES) {
  const path = join(root, "packages", name, "package.json");
  await updatePackage(path, name, "packages");
}

for (const name of EXTENSIONS) {
  const path = join(root, "extensions", name, "package.json");
  await updatePackage(path, name, "extensions");
}

console.log(`\nDone. ${CORE_PACKAGES.length + EXTENSIONS.length} packages updated.\n`);
console.log("Next steps:");
console.log("  1. pnpm build");
console.log("  2. npm login");
console.log(`  3. pnpm publish -r --tag beta --no-git-checks`);
console.log(`\nTesters install with:`);
console.log(`  npm install -g @yggdrasil/cli@beta`);
