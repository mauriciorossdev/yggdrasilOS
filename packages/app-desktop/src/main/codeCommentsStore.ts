import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app } from "electron";
import {
  addCodeComment,
  clearDoneCodeComments,
  dropRepoCodeComments,
  listCodeComments,
  removeCodeComment,
  setCodeCommentsStatus,
  updateCodeComment,
  type CodeComment,
  type CodeCommentStatus,
  type CodeCommentsFile,
  type NewCodeComment,
} from "./codeComments.js";

// userData/code-comments.json, same read-modify-write scheme as browserCommentsStore.ts.

function storePath(): string {
  return join(app.getPath("userData"), "code-comments.json");
}

async function readFileSafe(): Promise<CodeCommentsFile> {
  try {
    return JSON.parse(await readFile(storePath(), "utf8")) as CodeCommentsFile;
  } catch {
    return {};
  }
}

async function writeFileSafe(file: CodeCommentsFile): Promise<void> {
  await mkdir(dirname(storePath()), { recursive: true });
  await writeFile(storePath(), JSON.stringify(file, null, 2), "utf8");
}

// Serialise read-modify-write so two quick IPC calls can't clobber each other.
let queue: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

function mutate(fn: (file: CodeCommentsFile) => CodeCommentsFile): Promise<void> {
  return exclusive(async () => {
    const before = await readFileSafe();
    const after = fn(before);
    if (after !== before) await writeFileSafe(after);
  });
}

export async function listStoredCodeComments(projectId: string, repoRoot: string): Promise<CodeComment[]> {
  return listCodeComments(await readFileSafe(), projectId, repoRoot);
}

export function addStoredCodeComment(projectId: string, repoRoot: string, input: NewCodeComment): Promise<CodeComment> {
  return exclusive(async () => {
    const { file, comment } = addCodeComment(await readFileSafe(), projectId, repoRoot, input);
    await writeFileSafe(file);
    return comment;
  });
}

export const updateStoredCodeComment = (projectId: string, repoRoot: string, id: string, text: string): Promise<void> =>
  mutate((f) => updateCodeComment(f, projectId, repoRoot, id, text));

export const removeStoredCodeComment = (projectId: string, repoRoot: string, id: string): Promise<void> =>
  mutate((f) => removeCodeComment(f, projectId, repoRoot, id));

export const clearDoneStoredCodeComments = (projectId: string, repoRoot: string): Promise<void> =>
  mutate((f) => clearDoneCodeComments(f, projectId, repoRoot));

export const dropStoredRepoCodeComments = (projectId: string, repoRoot: string): Promise<void> =>
  mutate((f) => dropRepoCodeComments(f, projectId, repoRoot));

/** Resolves the repo roots touched; empty when none of the ids exist (stale id from an agent). */
export function setStoredCodeCommentsStatus(
  projectId: string,
  ids: string[],
  status: CodeCommentStatus,
  sentTo?: string,
): Promise<string[]> {
  return exclusive(async () => {
    const { file, changed, repoRoots } = setCodeCommentsStatus(await readFileSafe(), projectId, ids, status, sentTo);
    if (changed) await writeFileSafe(file);
    return repoRoots;
  });
}
