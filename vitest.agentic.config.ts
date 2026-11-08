import { defineConfig } from "vitest/config";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import base from "./vitest.config.js";

/**
 * Every workspace package pointed at its TypeScript source. The shared config only aliases a hand-picked few
 * (the rest resolve to their built `dist`), which is fine on a developer machine but would need a full build
 * inside the sandbox image; aliasing them all means the evals run from source anywhere.
 */
function workspaceAliases(): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const group of ["packages", "extensions"]) {
    const root = resolve(__dirname, group);
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root)) {
      const manifest = join(root, dir, "package.json");
      const entry = join(root, dir, "src", "index.ts");
      if (!existsSync(manifest) || !existsSync(entry)) continue;
      const name = (JSON.parse(readFileSync(manifest, "utf8")) as { name?: string }).name;
      if (name) aliases[name] = entry;
    }
  }
  return aliases;
}

// Agentic evals: slow, need a local Ollama, and are scored rather than strictly pass/fail — so they
// live outside the normal suite. Run with `pnpm eval:agentic` (see test/agentic/README.md).
export default defineConfig({
  ...base,
  test: {
    include: ["test/agentic/**/*.eval.ts"],
    environment: "node",
    testTimeout: 30 * 60_000,
    hookTimeout: 5 * 60_000,
    // One scenario at a time, in a forked process: scenarios chdir into their workspace.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    retry: 0,
    reporters: ["verbose"],
  },
  resolve: {
    alias: { ...((base as { resolve?: { alias?: Record<string, string> } }).resolve?.alias ?? {}), ...workspaceAliases() },
  },
});
