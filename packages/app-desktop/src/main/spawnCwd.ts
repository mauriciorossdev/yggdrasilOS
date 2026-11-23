import { statSync } from "node:fs";

/**
 * The folder a pane's process starts in. A saved pane can point at a folder
 * that's gone (a removed or merged worktree, a moved project): node-pty's
 * chdir then fails and the process exits with code 1 and no output, so the
 * pane shows only "[process exited (code 1)]" and Restart can't fix it.
 * Instead, start in the first fallback that exists (the project root, then
 * home) and report the missing folder so the pane can say what happened.
 */
export function resolveSpawnCwd(
  cwd: string,
  fallbacks: ReadonlyArray<string | undefined>,
  isDir: (path: string) => boolean = isDirectory,
): { cwd: string; missing?: string } {
  if (isDir(cwd)) return { cwd };
  const fallback = fallbacks.find((p): p is string => !!p && isDir(p));
  // Nothing usable either: keep the original and let the spawn fail as before.
  return fallback ? { cwd: fallback, missing: cwd } : { cwd };
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
