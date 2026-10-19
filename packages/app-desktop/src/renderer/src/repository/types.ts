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

export type RemoteInfo = { name: string; url: string };

export type StashInfo = { index: number; subject: string; date: string };

export type DiffSelection =
  | { kind: "change"; path: string; mode: "staged" | "unstaged" }
  | { kind: "commit"; sha: string; path: string; origPath?: string };

export type DiffContent = { original: string; modified: string; binary?: boolean; tooLarge?: boolean };
