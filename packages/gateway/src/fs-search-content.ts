import { open, readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

/** Where a match sits in a line, trimmed to a short window so a result can show it in context. */
export type ContentSnippet = {
  /** 1-based line number in the file. */
  line: number;
  text: string;
  /** The matched part, as offsets into `text`. */
  matchStart: number;
  matchEnd: number;
};

export type ContentSearchResult = {
  /** Relative to the workspace root, with `/` separators. */
  relativePath: string;
  /** The query is in the file's path. */
  nameMatch: boolean;
  /** How many times the query appears in the file's text. */
  matches: number;
  snippets: ContentSnippet[];
};

export type ContentSearchOptions = {
  /** Absolute workspace root; results are relative to it. */
  root: string;
  /** Folder to search, relative to `root` ("" = the whole workspace). */
  scope?: string;
  query: string;
  limit?: number;
  /** Snippets kept per file. */
  maxSnippets?: number;
};

export type ContentSearchOutcome = { results: ContentSearchResult[]; truncated: boolean };

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".yggdrasil"]);
const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svgz", "pdf", "zip", "gz", "tgz", "7z", "rar", "mp3", "wav", "ogg", "m4a",
  "mp4", "mov", "webm", "mkv", "glb", "gltf", "blend", "fbx", "obj", "stl", "woff", "woff2", "ttf", "otf", "docx", "xlsx", "pptx", "sqlite", "db",
]);
const MAX_FILE_BYTES = 1_000_000;
const MAX_FILES_SCANNED = 4000;
const DEFAULT_LIMIT = 50;
const DEFAULT_SNIPPETS = 2;
const WINDOW_BEFORE = 50;
const WINDOW_AFTER = 90;

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/** A few NUL bytes in the first chunk is how text and binary files are told apart without trusting extensions. */
async function looksBinary(path: string): Promise<boolean> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } finally {
    await handle.close();
  }
}

/** The part of a line around its first match, with ellipses where it was cut. */
export function snippetOf(line: string, index: number, length: number): { text: string; matchStart: number; matchEnd: number } {
  const start = Math.max(0, index - WINDOW_BEFORE);
  const end = Math.min(line.length, index + length + WINDOW_AFTER);
  const lead = start > 0 ? "…" : "";
  const text = `${lead}${line.slice(start, end).trimEnd()}${end < line.length ? "…" : ""}`;
  const matchStart = lead.length + (index - start);
  return { text, matchStart, matchEnd: matchStart + length };
}

/** Lines containing `needle` (already lowercased), up to `maxSnippets` of them, plus the total count of occurrences. */
export function findMatches(text: string, needle: string, maxSnippets: number): { matches: number; snippets: ContentSnippet[] } {
  const snippets: ContentSnippet[] = [];
  let matches = 0;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i]!.toLowerCase();
    let from = 0;
    let first = true;
    for (let at = lower.indexOf(needle, from); at >= 0; at = lower.indexOf(needle, from)) {
      matches++;
      if (first && snippets.length < maxSnippets) {
        snippets.push({ line: i + 1, ...snippetOf(lines[i]!, at, needle.length) });
      }
      first = false;
      from = at + needle.length;
    }
  }
  return { matches, snippets };
}

/**
 * Finds files under `scope` whose path or text contains `query` (case-insensitive).
 * Path matches come first, then the files with the most occurrences. Folders that are
 * never worth searching (node_modules, .git, build output) and binary or very large
 * files are skipped, and the walk stops after a fixed number of files so a huge
 * folder can't make it run away; `truncated` says when a cap cut the result short.
 */
export async function searchContent(options: ContentSearchOptions): Promise<ContentSearchOutcome> {
  const needle = options.query.trim().toLowerCase();
  if (!needle) return { results: [], truncated: false };

  const root = resolve(options.root);
  const start = resolve(root, options.scope ?? "");
  const limit = options.limit ?? DEFAULT_LIMIT;
  const maxSnippets = options.maxSnippets ?? DEFAULT_SNIPPETS;

  const results: ContentSearchResult[] = [];
  let scanned = 0;
  let truncated = false;

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
        continue;
      }
      if (!entry.isFile()) continue;
      if (scanned >= MAX_FILES_SCANNED) {
        truncated = true;
        return;
      }
      scanned++;

      const relativePath = relative(root, abs).split(sep).join("/");
      const nameMatch = relativePath.toLowerCase().includes(needle);
      let matches = 0;
      let snippets: ContentSnippet[] = [];

      if (!BINARY_EXTENSIONS.has(extensionOf(entry.name))) {
        try {
          const info = await stat(abs);
          if (info.size <= MAX_FILE_BYTES && !(await looksBinary(abs))) {
            ({ matches, snippets } = findMatches(await readFile(abs, "utf8"), needle, maxSnippets));
          }
        } catch {
          // Unreadable file: it can still match by name.
        }
      }
      if (!nameMatch && matches === 0) continue;
      results.push({ relativePath, nameMatch, matches, snippets });
    }
  }

  await walk(start);

  results.sort((a, b) => {
    if (a.nameMatch !== b.nameMatch) return a.nameMatch ? -1 : 1;
    if (a.matches !== b.matches) return b.matches - a.matches;
    return a.relativePath.localeCompare(b.relativePath);
  });
  if (results.length > limit) {
    results.length = limit;
    truncated = true;
  }
  return { results, truncated };
}
