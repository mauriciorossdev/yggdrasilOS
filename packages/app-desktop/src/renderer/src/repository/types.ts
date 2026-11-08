// Mirrors packages/gateway/src/git-methods.ts (git.* methods behind the Repositorio tab).

export type RepoRelation = "root" | "parent" | "child";

export type RepoInfo = {
  /** Relative to the project root: "." / "apps/web" / "../.." */
  path: string;
  name: string;
  branch?: string;
  relation: RepoRelation;
};

export type GitChange = {
  path: string;
  origPath?: string;
  index: string;
  worktree: string;
  kind: "changed" | "renamed" | "unmerged" | "untracked";
};

export type RepoStatus = {
  branch?: string;
  detached: boolean;
  upstream?: string;
  ahead: number;
  behind: number;
  changes: GitChange[];
  merging: boolean;
};

export type BranchInfo = {
  name: string;
  remote: boolean;
  current: boolean;
  upstream?: string;
  ahead: number;
  behind: number;
  sha: string;
  subject: string;
};

export type CommitInfo = {
  sha: string;
  short: string;
  author: string;
  email: string;
  date: string;
  parents: string[];
  refs: string[];
  subject: string;
};

export type CommitFile = { status: string; path: string; origPath?: string };

export type CommitDetail = {
  sha: string;
  author: string;
  email: string;
  date: string;
  message: string;
  files: CommitFile[];
};

export type WorktreeOrigin = "main" | "app" | "claude" | "manual";

/** One entry of git.worktrees — a linked worktree (or the repo's own checkout) plus what git says about it. */
export type WorktreeInfo = {
  path: string;
  head: string;
  branch?: string;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  lockReason?: string;
  prunable: boolean;
  main: boolean;
  origin: WorktreeOrigin;
  /** The Claude Code session that locked this worktree, and whether its process is still running. */
  claudeSession?: { name: string; pid: number; alive: boolean };
  /** Changed + untracked files. */
  changes: number;
  /** Commits ahead of the main checkout's branch. */
  ahead: number;
  /** The folder is gone or git can't read it (prunable). */
  missing: boolean;
};

export type RemoteInfo = { name: string; url: string };

export type StashInfo = { index: number; subject: string; date: string };

export type DiffSelection =
  | { kind: "change"; path: string; mode: "staged" | "unstaged" }
  | { kind: "commit"; sha: string; path: string; origPath?: string };

export type DiffContent = { original: string; modified: string; binary?: boolean; tooLarge?: boolean };
