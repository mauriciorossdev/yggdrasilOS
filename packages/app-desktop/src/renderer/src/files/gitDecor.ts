import type { GitFileEntry, GitFileStatus } from "../types.js";

export type GitLetter = "M" | "A" | "D" | "R" | "?" | "!";

const LETTER: Record<GitFileStatus, GitLetter> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "?",
  unmerged: "!",
};

export type GitDecor = {
  /** Repo-relative file path → its status letter. */
  files: Map<string, GitLetter>;
  /** Every folder (repo-relative) that contains a change, at any depth. */
  dirs: Set<string>;
};

export const EMPTY_GIT_DECOR: GitDecor = { files: new Map(), dirs: new Set() };

/**
 * What the tree shows for `git status`: a letter on each changed file and a
 * dot on every folder above one. An untracked folder arrives as `dir/` (git
 * doesn't list what's inside), so it is marked as a folder itself.
 */
export function buildGitDecor(entries: GitFileEntry[]): GitDecor {
  const files = new Map<string, GitLetter>();
  const dirs = new Set<string>();
  for (const { path, status } of entries) {
    const isDir = path.endsWith("/");
    const clean = isDir ? path.slice(0, -1) : path;
    if (!clean) continue;
    if (isDir) dirs.add(clean);
    else files.set(clean, LETTER[status]);
    let slash = clean.lastIndexOf("/");
    while (slash > 0) {
      dirs.add(clean.slice(0, slash));
      slash = clean.lastIndexOf("/", slash - 1);
    }
  }
  return { files, dirs };
}
