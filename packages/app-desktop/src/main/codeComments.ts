import { randomUUID } from "node:crypto";

/**
 * Pure model for review comments on code: line ranges the user marks in a diff
 * or in the file editor, sent together to an agent as one prompt. Same statuses
 * as the Browser's element comments (browserComments.ts). Persistence lives in
 * codeCommentsStore.ts. See notes/features/code-review-comments.md.
 */

/** idle: not sent yet · sent: handed to an agent · done: the agent (or the user) resolved it. */
export type CodeCommentStatus = "idle" | "sent" | "done";

/** Which side of a diff the lines belong to. The file editor always comments on "modified" (the working copy). */
export type CodeCommentSide = "modified" | "original";

export type CodeComment = {
  id: string;
  /** Path relative to the repo or worktree root, with forward slashes. */
  path: string;
  side: CodeCommentSide;
  /** 1-based, inclusive. */
  startLine: number;
  endLine: number;
  /** The text of those lines when the comment was made: relocates it after edits and goes into the prompt. */
  snippet: string;
  /** Set when commenting on a commit from the history, not on the working copy. */
  commitSha?: string;
  comment: string;
  createdAt: number;
  status: CodeCommentStatus;
  /** Who it was last sent to (pane title / provider label), for display. */
  sentTo?: string;
};

export type NewCodeComment = Pick<CodeComment, "path" | "side" | "startLine" | "endLine" | "snippet" | "commitSha" | "comment">;

/** projectId → absolute repo/worktree root → comments */
export type CodeCommentsFile = Record<string, Record<string, CodeComment[]>>;

const MAX_COMMENT = 8000;
const MAX_SNIPPET = 20_000;

export function listCodeComments(file: CodeCommentsFile, projectId: string, repoRoot: string): CodeComment[] {
  return file[projectId]?.[repoRoot] ?? [];
}

function withRepo(file: CodeCommentsFile, projectId: string, repoRoot: string, list: CodeComment[]): CodeCommentsFile {
  const { [repoRoot]: _drop, ...rest } = file[projectId] ?? {};
  return { ...file, [projectId]: list.length > 0 ? { ...rest, [repoRoot]: list } : rest };
}

/** The input crosses IPC from the renderer: coerce it instead of trusting it. Undefined when it isn't a usable comment. */
export function sanitizeNewCodeComment(input: unknown): NewCodeComment | undefined {
  if (!input || typeof input !== "object") return undefined;
  const o = input as Record<string, unknown>;
  const path = typeof o.path === "string" ? o.path.replace(/\\/g, "/").replace(/^\/+/, "") : "";
  const comment = typeof o.comment === "string" ? o.comment.trim().slice(0, MAX_COMMENT) : "";
  const start = Number(o.startLine);
  const end = Number(o.endLine);
  if (!path || path.split("/").includes("..") || !comment) return undefined;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) return undefined;
  return {
    path,
    side: o.side === "original" ? "original" : "modified",
    startLine: start,
    endLine: end,
    snippet: typeof o.snippet === "string" ? o.snippet.slice(0, MAX_SNIPPET) : "",
    commitSha: typeof o.commitSha === "string" && /^[0-9a-f]{4,64}$/i.test(o.commitSha) ? o.commitSha : undefined,
    comment,
  };
}

export function addCodeComment(
  file: CodeCommentsFile,
  projectId: string,
  repoRoot: string,
  input: NewCodeComment,
  now: number = Date.now(),
): { file: CodeCommentsFile; comment: CodeComment } {
  const comment: CodeComment = { ...input, id: randomUUID(), createdAt: now, status: "idle" };
  return { comment, file: withRepo(file, projectId, repoRoot, [...listCodeComments(file, projectId, repoRoot), comment]) };
}

/** Rewording a comment makes it a fresh request: whatever was sent/done no longer matches the text. */
export function updateCodeComment(
  file: CodeCommentsFile,
  projectId: string,
  repoRoot: string,
  id: string,
  text: string,
): CodeCommentsFile {
  const list = listCodeComments(file, projectId, repoRoot);
  const trimmed = text.trim().slice(0, MAX_COMMENT);
  if (!trimmed || !list.some((c) => c.id === id)) return file;
  return withRepo(
    file,
    projectId,
    repoRoot,
    list.map((c) => (c.id === id ? { ...c, comment: trimmed, status: "idle" as const, sentTo: undefined } : c)),
  );
}

/**
 * Sets the status of the given comments wherever they live in the project (an
 * agent only knows ids, not repos). `changed` is false when no id matched;
 * `repoRoots` lists the repos touched, to refresh their views.
 */
export function setCodeCommentsStatus(
  file: CodeCommentsFile,
  projectId: string,
  ids: string[],
  status: CodeCommentStatus,
  sentTo?: string,
): { file: CodeCommentsFile; changed: boolean; repoRoots: string[] } {
  const project = file[projectId];
  if (!project) return { file, changed: false, repoRoots: [] };
  const repoRoots: string[] = [];
  const next: Record<string, CodeComment[]> = {};
  for (const [root, list] of Object.entries(project)) {
    let touched = false;
    next[root] = list.map((c) => {
      if (!ids.includes(c.id)) return c;
      touched = true;
      return { ...c, status, sentTo: status === "idle" ? undefined : (sentTo ?? c.sentTo) };
    });
    if (touched) repoRoots.push(root);
  }
  return repoRoots.length > 0 ? { file: { ...file, [projectId]: next }, changed: true, repoRoots } : { file, changed: false, repoRoots };
}

export function removeCodeComment(file: CodeCommentsFile, projectId: string, repoRoot: string, id: string): CodeCommentsFile {
  const list = listCodeComments(file, projectId, repoRoot);
  if (!list.some((c) => c.id === id)) return file;
  return withRepo(file, projectId, repoRoot, list.filter((c) => c.id !== id));
}

export function clearDoneCodeComments(file: CodeCommentsFile, projectId: string, repoRoot: string): CodeCommentsFile {
  const list = listCodeComments(file, projectId, repoRoot);
  if (!list.some((c) => c.status === "done")) return file;
  return withRepo(file, projectId, repoRoot, list.filter((c) => c.status !== "done"));
}

/** Drops every comment of a repo root (a worktree that was removed). */
export function dropRepoCodeComments(file: CodeCommentsFile, projectId: string, repoRoot: string): CodeCommentsFile {
  if (!file[projectId]?.[repoRoot]) return file;
  return withRepo(file, projectId, repoRoot, []);
}
