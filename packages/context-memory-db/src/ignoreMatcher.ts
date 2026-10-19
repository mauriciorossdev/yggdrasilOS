import { readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import ignore from "ignore";

export type IgnoreMatcher = ReturnType<typeof ignore>;

// Always excluded regardless of .gitignore content — .git is git's own
// internals (never source), .yggdrasil is this app's own local state (the
// index database itself lives there), and node_modules is the one
// directory that reliably blows up a walk on a project that happens not to
// gitignore it.
const ALWAYS_IGNORED = [".git", ".yggdrasil", "node_modules"];

/**
 * Same approach as the gateway's own fs-ignore.ts (used for its file
 * browser/watcher) — kept as a local copy here rather than a dependency on
 * @yggdrasil/gateway, since this plugin ships standalone (see this
 * package's publishConfig) and shouldn't depend on the host that loads it.
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
