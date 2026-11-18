#!/usr/bin/env node
// node-pty ships its macOS `spawn-helper` prebuilds without the executable bit
// (seen with 1.1.0 installed by pnpm). Without it every terminal fails with
// `Error: posix_spawnp failed.` Restore +x on whatever helpers are present.
// No-op on Windows (node-pty uses conpty there, no spawn-helper).
import { chmodSync, existsSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

if (process.platform === "win32") process.exit(0);

let ptyDir;
try {
  ptyDir = path.dirname(createRequire(import.meta.url).resolve("node-pty/package.json"));
} catch {
  process.exit(0); // node-pty not installed — nothing to fix
}

const candidates = [path.join(ptyDir, "build", "Release", "spawn-helper")];
const prebuilds = path.join(ptyDir, "prebuilds");
if (existsSync(prebuilds)) {
  for (const dir of readdirSync(prebuilds)) candidates.push(path.join(prebuilds, dir, "spawn-helper"));
}

for (const file of candidates) {
  if (!existsSync(file)) continue;
  const mode = statSync(file).mode;
  if ((mode & 0o111) !== 0o111) {
    chmodSync(file, mode | 0o755);
    console.log(`[fix-node-pty-perms] +x ${path.relative(ptyDir, file)}`);
  }
}
