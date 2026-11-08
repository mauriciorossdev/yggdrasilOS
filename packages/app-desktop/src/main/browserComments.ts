import { randomUUID } from "node:crypto";

/**
 * Pure model for the Browser tab's element comments ("change requests" the
 * user pins on a page and later delegates to an agent). No fs / electron
 * imports on purpose so it is unit-testable — persistence lives in
 * browserCommentsStore.ts.
 */

/** idle: not delegated yet · sent: handed to an agent · done: agent (or the user) marked it finished. */
export type CommentStatus = "idle" | "sent" | "done";

/** change: a UI change to apply in the source · capture: information on the page to save (see browserCaptureBundle.ts). */
export type CommentKind = "change" | "capture";
/** What a capture grabs: the commented element, the page's main article, the whole page, or just the link. */
export type CaptureScope = "element" | "article" | "page" | "url";

export type BrowserComment = {
  id: string;
  selector: string;
  tag: string;
  elId?: string;
  classes?: string;
  text: string;
  outerHtml: string;
  comment: string;
  pageUrl: string;
  pageTitle: string;
  createdAt: number;
  /** Absent on comments saved before captures existed — read as "change". */
  kind?: CommentKind;
  /** Only for kind "capture". */
  scope?: CaptureScope;
  /** Absent on comments saved before statuses existed — read as "idle". */
  status?: CommentStatus;
  /** Who it was last sent to (pane title / provider label), for display. */
  sentTo?: string;
};

export type NewBrowserComment = Omit<BrowserComment, "id" | "createdAt" | "status" | "sentTo">;

/** projectId → pageKey → comments */
export type BrowserCommentsFile = Record<string, Record<string, BrowserComment[]>>;

/** origin + pathname: query/hash are noise for "which view is this" (and SPA hash routes would otherwise fragment the list). */
export function pageKeyFor(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return url;
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}

export function listComments(file: BrowserCommentsFile, projectId: string, pageKey: string): BrowserComment[] {
  return file[projectId]?.[pageKey] ?? [];
}

export function addComment(
  file: BrowserCommentsFile,
  projectId: string,
  input: NewBrowserComment,
  now: number = Date.now(),
): { file: BrowserCommentsFile; comment: BrowserComment } {
  // The input crosses an IPC boundary from the page's preload: coerce the enums instead of trusting them.
  const kind: CommentKind = input.kind === "capture" ? "capture" : "change";
  const scope: CaptureScope | undefined =
    kind === "capture"
      ? input.scope === "article" || input.scope === "page" || input.scope === "url"
        ? input.scope
        : "element"
      : undefined;
  const comment: BrowserComment = { ...input, kind, scope, id: randomUUID(), createdAt: now };
  const key = pageKeyFor(input.pageUrl);
  const project = file[projectId] ?? {};
  return {
    comment,
    file: { ...file, [projectId]: { ...project, [key]: [...(project[key] ?? []), comment] } },
  };
}

export function updateComment(
  file: BrowserCommentsFile,
  projectId: string,
  pageKey: string,
  id: string,
  text: string,
): BrowserCommentsFile {
  const project = file[projectId];
  const list = project?.[pageKey];
  if (!project || !list) return file;
  return {
    ...file,
    // Rewording a comment makes it a fresh request: whatever was sent/done no longer matches the text.
    [projectId]: {
      ...project,
      [pageKey]: list.map((c) => (c.id === id ? { ...c, comment: text, status: "idle" as const, sentTo: undefined } : c)),
    },
  };
}

/** Sets the status of the given comments wherever they live in the project (an agent only knows ids, not pages). `changed` is false when no id matched. */
export function setCommentsStatus(
  file: BrowserCommentsFile,
  projectId: string,
  ids: string[],
  status: CommentStatus,
  sentTo?: string,
): { file: BrowserCommentsFile; changed: boolean } {
  const project = file[projectId];
  if (!project) return { file, changed: false };
  let changed = false;
  const next: Record<string, BrowserComment[]> = {};
  for (const [key, list] of Object.entries(project)) {
    next[key] = list.map((c) => {
      if (!ids.includes(c.id)) return c;
      changed = true;
      return { ...c, status, sentTo: status === "idle" ? undefined : (sentTo ?? c.sentTo) };
    });
  }
  return changed ? { file: { ...file, [projectId]: next }, changed } : { file, changed };
}

export function removeComment(
  file: BrowserCommentsFile,
  projectId: string,
  pageKey: string,
  id: string,
): BrowserCommentsFile {
  const project = file[projectId];
  const list = project?.[pageKey];
  if (!project || !list) return file;
  const next = list.filter((c) => c.id !== id);
  const { [pageKey]: _drop, ...rest } = project;
  return { ...file, [projectId]: next.length > 0 ? { ...rest, [pageKey]: next } : rest };
}
