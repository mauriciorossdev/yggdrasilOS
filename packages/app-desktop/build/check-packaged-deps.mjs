// electron-builder afterPack hook: fails the build when a package copied into
// the app is missing one of its `dependencies`.
//
// electron-builder's pnpm collector skips the children of packages it reports
// as "duplicate dependency references". 0.1.1 shipped without
// @yggdrasil/context-runtime and @yggdrasil/tool-builtin because of it, and the
// gateway couldn't start. This catches the same gap for any package, first or
// third party, before an installer is built.
//
// Also runs standalone: node build/check-packaged-deps.mjs <path to resources/app>
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// Every package folder under a node_modules dir, scoped and nested included.
function* packageDirs(nodeModules) {
  let entries;
  try {
    entries = fs.readdirSync(nodeModules, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const dir = path.join(nodeModules, entry.name);
    if (entry.name.startsWith("@")) {
      for (const scoped of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!scoped.isDirectory()) continue;
        const pkgDir = path.join(dir, scoped.name);
        yield pkgDir;
        yield* packageDirs(path.join(pkgDir, "node_modules"));
      }
    } else {
      yield dir;
      yield* packageDirs(path.join(dir, "node_modules"));
    }
  }
}

// Node's lookup: <dir>/node_modules/<name> from the package up to the app root.
function resolves(fromDir, name, appDir) {
  let dir = fromDir;
  for (;;) {
    if (fs.existsSync(path.join(dir, "node_modules", name, "package.json"))) return true;
    if (dir === appDir) return false;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

export function findMissing(appDir) {
  appDir = path.resolve(appDir);
  const missing = [];
  const dirs = [appDir, ...packageDirs(path.join(appDir, "node_modules"))];
  for (const dir of dirs) {
    const pkg = readJson(path.join(dir, "package.json"));
    if (!pkg) continue;
    const optional = new Set(Object.keys(pkg.optionalDependencies ?? {}));
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      if (optional.has(name)) continue;
      if (!resolves(dir, name, appDir)) {
        missing.push({ name, neededBy: pkg.name ?? path.relative(appDir, dir) });
      }
    }
  }
  return missing;
}

function appDirOf(context) {
  if (context.electronPlatformName === "darwin") {
    const app = `${context.packager.appInfo.productFilename}.app`;
    return path.join(context.appOutDir, app, "Contents", "Resources", "app");
  }
  return path.join(context.appOutDir, "resources", "app");
}

function check(appDir) {
  const missing = findMissing(appDir);
  if (missing.length === 0) {
    console.log(`  • packaged dependencies complete  appDir=${appDir}`);
    return;
  }
  const list = missing.map((m) => `  ${m.name} (needed by ${m.neededBy})`).join("\n");
  throw new Error(
    `The packaged app is missing ${missing.length} dependencies:\n${list}\n` +
      "Add the missing workspace packages to packages/app-desktop/package.json dependencies.",
  );
}

export default async function afterPack(context) {
  check(appDirOf(context));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    check(process.argv[2] ?? ".");
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
