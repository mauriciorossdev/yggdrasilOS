const clean = (p: string): string => p.replace(/\\/g, "/").replace(/\/+$/, "");

/** Windows paths (C:/..., //server/share) are case-insensitive, so compare them folded; POSIX stays exact. */
export function pathKey(p: string): string {
  const c = clean(p);
  return /^[A-Za-z]:\//.test(c) || c.startsWith("//") ? c.toLowerCase() : c;
}

/** True when `path` is `root` or lives inside it. */
export function isInside(root: string, path: string): boolean {
  const r = pathKey(root);
  const p = pathKey(path);
  return p === r || p.startsWith(`${r}/`);
}

/**
 * The `repo` param the git.* methods expect for a worktree: its path relative
 * to the project root ("." for the root itself). Null when it lives outside
 * the root (a sibling folder), which the gateway refuses to operate on. git
 * prints Windows paths with forward slashes and the OS may differ in case, so
 * the match is separator- and (on Windows) case-insensitive.
 */
export function worktreeRepoParam(workspaceRoot: string, worktreePath: string): string | null {
  if (!isInside(workspaceRoot, worktreePath)) return null;
  const root = clean(workspaceRoot);
  const path = clean(worktreePath);
  return path.length === root.length ? "." : path.slice(root.length + 1);
}

/** Path to show in the list: relative to the project when inside it, else the full path. */
export function worktreeDisplayPath(workspaceRoot: string, worktreePath: string): string {
  return worktreeRepoParam(workspaceRoot, worktreePath) ?? clean(worktreePath);
}
