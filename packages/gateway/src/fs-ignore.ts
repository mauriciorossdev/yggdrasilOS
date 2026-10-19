import { readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import ignore from "ignore";

export type IgnoreMatcher = ReturnType<typeof ignore>;

// Always hidden regardless of .gitignore content. .git is git's own
// internals (nobody browses it from a file tree, and it can be huge —
// packfiles — on an old repo). node_modules is the load-bearing one: a
// project whose actual .gitignore lives one level below workspaceRoot (a
// monorepo wrapper dir with no .gitignore of its own, real code in a nested
// folder that has one) leaves this matcher with nothing to exclude it —
// fs-watch.ts's chokidar then recursively fs.watch()s every directory in
// node_modules individually (chokidar 5 dropped its native macOS backend,
// no single recursive handle), and a real dependency tree can hit the
// tens-of-thousands of directories fast enough to exhaust the OS's watch
// capacity (EMFILE) well before any generic `ulimit -n` bump would help —
// reproduced against a real 12k+ directory node_modules. Excluding it
// unconditionally, the same way context-memory-db's own ignoreMatcher.ts
// already does for indexing, closes that gap regardless of .gitignore
// placement.
// Same reasoning as node_modules above, generalized: any of these can reach
// tens of thousands of directories (build caches, dependency dirs) and are
// never worth recursively watching or listing, regardless of where the
// project's real .gitignore happens to live. Reproduced against a real
// project (b-health) whose workspaceRoot has no .gitignore of its own — its
// nested monorepo's .gitignore (one level down) lists .next/.expo/etc, but
// this matcher never reads it, and an untracked apps/ tree with Next.js +
// Expo build caches (6.7GB, tens of thousands of dirs) exhausted the OS's
// watch-handle limit (EMFILE) well before node_modules even came into play.
const ALWAYS_IGNORED = [
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".expo",
  ".turbo",
  ".cache",
  ".parcel-cache",
  "coverage",
  "target",
  ".venv",
  "venv",
  "__pycache__",
];

/**
 * Builds a matcher for paths that should stay out of fs.list/fs watch:
 * the project's own .gitignore (if any) plus .git itself. This is what keeps
 * node_modules/dist/coverage/build output — the actual "muy grande"
 * directories in practice — out of the tree and the watcher, rather than
 * just truncating or timing out on them.
 */
export async function loadIgnoreMatcher(workspaceRoot: string): Promise<IgnoreMatcher> {
  const ig = ignore().add(ALWAYS_IGNORED);
  try {
    const raw = await readFile(join(workspaceRoot, ".gitignore"), "utf8");
    ig.add(raw);
  } catch {
    // No .gitignore — just the always-ignored list above.
  }
  return ig;
}

/** `ignore()`'s matcher wants root-relative, forward-slash paths. */
export function toIgnoreTestPath(workspaceRoot: string, absolutePath: string): string {
  return relative(workspaceRoot, absolutePath).split(sep).join("/");
}
