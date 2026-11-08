import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

/** A link from a note to another note. */
export type NoteLink = {
  /** The note it points at, project-relative with `/` separators. */
  target: string;
  /** 1-based line of the link in the source note. */
  line: number;
  /** That line, trimmed, so a backlink can show the context it was written in. */
  text: string;
};

export type NoteInfo = {
  /** Project-relative path. */
  path: string;
  /** First `# heading`, else the file name without extension. */
  title: string;
  links: NoteLink[];
};

const NOTE_EXTENSION = /\.(md|markdown)$/i;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".yggdrasil"]);
const MAX_NOTES = 5000;
const MAX_NOTE_BYTES = 1_000_000;
const CONTEXT_CHARS = 160;
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;
// [text](target) or [text](target "title"), but not an image (![text](...)).
const LINK = /(?<!!)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function isNote(path: string): boolean {
  return NOTE_EXTENSION.test(path);
}

/**
 * The project-relative path a link written in `notePath` points at: relative to the note's folder, `/` for the
 * project root, `..` to climb, `%20` decoded, anchors and queries dropped. Null for an external address, a bare
 * `#anchor`, or a path that leaves the project.
 */
export function resolveNoteLink(notePath: string, href: string): string | null {
  const clean = href.split("#")[0]!.split("?")[0]!.trim().replace(/^<|>$/g, "");
  if (!clean || EXTERNAL.test(href.trim())) return null;
  let decoded = clean;
  try {
    decoded = decodeURI(clean);
  } catch {
    // Not valid percent-encoding: take it literally.
  }
  const dir = notePath.includes("/") ? notePath.slice(0, notePath.lastIndexOf("/")) : "";
  const segments = decoded.startsWith("/") ? decoded.split("/") : [...dir.split("/"), ...decoded.split("/")];
  const stack: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (stack.length === 0) return null;
      stack.pop();
    } else stack.push(segment);
  }
  return stack.length > 0 ? stack.join("/") : null;
}

/** The title of a note: its first level-1 heading near the top (past any front matter), else its file name. */
export function noteTitle(markdown: string, path: string): string {
  const lines = markdown.split(/\r?\n/);
  let i = 0;
  if (lines[0]?.trim() === "---") {
    const close = lines.findIndex((l, n) => n > 0 && l.trim() === "---");
    if (close > 0) i = close + 1;
  }
  let fence = false;
  for (let n = i; n < Math.min(lines.length, i + 60); n++) {
    const line = lines[n]!;
    if (/^\s{0,3}(```|~~~)/.test(line)) fence = !fence;
    if (fence) continue;
    const heading = /^#\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) return heading[1]!.replace(/[*_`]+/g, "").trim() || fallbackTitle(path);
  }
  return fallbackTitle(path);
}

function fallbackTitle(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.replace(NOTE_EXTENSION, "");
}

/**
 * Links from a note to other notes: markdown links whose target resolves to a `.md` file inside the project.
 * Skips the front matter, fenced code, images and external addresses; a note linking to itself is ignored and
 * a note linking to the same target twice on one line counts once.
 */
export function extractLinks(markdown: string, notePath: string): NoteLink[] {
  const lines = markdown.split(/\r?\n/);
  const links: NoteLink[] = [];
  let i = 0;
  if (lines[0]?.trim() === "---") {
    const close = lines.findIndex((l, n) => n > 0 && l.trim() === "---");
    if (close > 0) i = close + 1;
  }
  let fence: string | null = null;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1]![0]!;
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const seen = new Set<string>();
    for (const match of line.matchAll(LINK)) {
      const target = resolveNoteLink(notePath, match[2]!);
      if (!target || !isNote(target) || target === notePath || seen.has(target)) continue;
      seen.add(target);
      const text = line.trim();
      links.push({ target, line: i + 1, text: text.length > CONTEXT_CHARS ? `${text.slice(0, CONTEXT_CHARS)}…` : text });
    }
  }
  return links;
}

export type IndexOptions = {
  /** Absolute workspace root; paths in the result are relative to it. */
  root: string;
  /** Folder to index, relative to `root` (e.g. "notes"). */
  scope: string;
  /** Index only these notes (project-relative); the ones that no longer exist are left out. Default: every note under `scope`. */
  paths?: string[];
};

export type IndexOutcome = { notes: NoteInfo[]; truncated: boolean };

async function indexFile(root: string, relativePath: string): Promise<NoteInfo | null> {
  try {
    const abs = resolve(root, relativePath);
    const info = await stat(abs);
    if (!info.isFile() || info.size > MAX_NOTE_BYTES) return null;
    const text = await readFile(abs, "utf8");
    return { path: relativePath, title: noteTitle(text, relativePath), links: extractLinks(text, relativePath) };
  } catch {
    return null;
  }
}

/** Titles and outgoing note links for the notes under a folder (or for the given paths), the raw material of backlinks and of the `[[` picker. */
export async function indexNotes(options: IndexOptions): Promise<IndexOutcome> {
  const root = resolve(options.root);
  const notes: NoteInfo[] = [];
  let truncated = false;

  if (options.paths) {
    for (const path of options.paths) {
      if (!isNote(path)) continue;
      const note = await indexFile(root, path);
      if (note) notes.push(note);
    }
    return { notes, truncated };
  }

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (truncated) return;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(abs);
      } else if (entry.isFile() && isNote(entry.name)) {
        if (notes.length >= MAX_NOTES) {
          truncated = true;
          return;
        }
        const note = await indexFile(root, relative(root, abs).split(sep).join("/"));
        if (note) notes.push(note);
      }
    }
  }
  await walk(resolve(root, options.scope));
  return { notes, truncated };
}
