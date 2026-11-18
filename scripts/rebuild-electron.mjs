#!/usr/bin/env node
// Rebuilds the native modules the desktop app loads inside Electron (gateway runs
// with ELECTRON_RUN_AS_NODE) against Electron's ABI instead of the system Node's.
//
// - node-pty and other direct deps of app-desktop: `electron-builder install-app-deps`.
// - better-sqlite3: arrives transitively (via context-memory-db), which
//   install-app-deps skips, so it gets the Electron prebuild via prebuild-install
//   (falling back to a node-gyp build against Electron's headers).
//
// Note: there's a single copy of better-sqlite3 in node_modules, so after this
// anything loading it from plain Node (e.g. vitest) will hit the reverse ABI error
// until you reinstall/rebuild it for Node.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopDir = path.join(root, "packages/app-desktop");
const memoryDbDir = path.join(root, "packages/context-memory-db");

const desktopRequire = createRequire(path.join(desktopDir, "package.json"));
const electronVersion = desktopRequire("electron/package.json").version;
const arch = process.env.npm_config_arch || process.arch;

const run = (cmd, args, cwd) => {
  console.log(`\n$ ${cmd} ${args.join(" ")}   (in ${path.relative(root, cwd) || "."})`);
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
};

console.log(`Rebuilding native modules for Electron ${electronVersion} (${arch})`);

// 1) Direct deps of app-desktop (node-pty, ...).
run("pnpm", ["exec", "electron-builder", "install-app-deps"], desktopDir);

// 2) better-sqlite3 (transitive, skipped by install-app-deps).
const memoryDbRequire = createRequire(path.join(memoryDbDir, "package.json"));
const sqliteDir = path.dirname(memoryDbRequire.resolve("better-sqlite3/package.json"));
const sqliteRequire = createRequire(path.join(sqliteDir, "package.json"));
const prebuildInstall = sqliteRequire.resolve("prebuild-install/bin.js");
try {
  run(
    process.execPath,
    [prebuildInstall, "--runtime", "electron", "--target", electronVersion, "--arch", arch],
    sqliteDir,
  );
} catch {
  console.log("No prebuild available — building better-sqlite3 from source against Electron headers");
  run(
    "npx",
    [
      "--yes",
      "node-gyp",
      "rebuild",
      "--release",
      `--target=${electronVersion}`,
      `--arch=${arch}`,
      "--dist-url=https://electronjs.org/headers",
    ],
    sqliteDir,
  );
}

console.log("\nDone.");
