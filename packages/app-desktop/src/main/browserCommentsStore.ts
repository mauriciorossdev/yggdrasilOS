import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app } from "electron";
import {
  addComment,
  listComments,
  pageKeyFor,
  removeComment,
  setCommentsStatus,
  updateComment,
  type CommentStatus,
  type BrowserComment,
  type BrowserCommentsFile,
  type NewBrowserComment,
} from "./browserComments.js";

function storePath(): string {
  return join(app.getPath("userData"), "browser-comments.json");
}

async function readFileSafe(): Promise<BrowserCommentsFile> {
  try {
    return JSON.parse(await readFile(storePath(), "utf8")) as BrowserCommentsFile;
  } catch {
    return {};
  }
}

async function writeFileSafe(file: BrowserCommentsFile): Promise<void> {
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

export async function listBrowserComments(projectId: string, pageUrl: string): Promise<BrowserComment[]> {
  return listComments(await readFileSafe(), projectId, pageKeyFor(pageUrl));
}

export function addBrowserComment(projectId: string, input: NewBrowserComment): Promise<BrowserComment> {
  return exclusive(async () => {
    const { file, comment } = addComment(await readFileSafe(), projectId, input);
    await writeFileSafe(file);
    return comment;
  });
}

export function updateBrowserComment(projectId: string, pageUrl: string, id: string, text: string): Promise<void> {
  return exclusive(async () => {
    await writeFileSafe(updateComment(await readFileSafe(), projectId, pageKeyFor(pageUrl), id, text));
  });
}

export function removeBrowserComment(projectId: string, pageUrl: string, id: string): Promise<void> {
  return exclusive(async () => {
    await writeFileSafe(removeComment(await readFileSafe(), projectId, pageKeyFor(pageUrl), id));
  });
}

/** Resolves false when none of the ids exist (stale id from an agent). */
export function setBrowserCommentsStatus(
  projectId: string,
  ids: string[],
  status: CommentStatus,
  sentTo?: string,
): Promise<boolean> {
  return exclusive(async () => {
    const { file, changed } = setCommentsStatus(await readFileSafe(), projectId, ids, status, sentTo);
    if (changed) await writeFileSafe(file);
    return changed;
  });
}
