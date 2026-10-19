// TODO: this native addon's ABI flips between Node and Electron depending
// on install order — see docs/known-issues.md for the permanent fix.
import Database from "better-sqlite3";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { loadIgnoreMatcher, toIgnoreTestPath, type IgnoreMatcher } from "./ignoreMatcher.js";

export type MemoryRow = {
  id: number;
  agent_id: string | null;
  content: string;
  type: string;
  created_at: number;
  updated_at: number;
  relevance: number;
};

// Keyed by resolved db file path, not a single global — a gateway subprocess
// (the original caller) only ever opens one workspace so this used to be a
// bare singleton, but app-desktop's main process calls this for MULTIPLE
// simultaneously-open project windows; a single-slot cache would silently
// hand project B's calls project A's already-open database handle.
const dbCache = new Map<string, Database.Database>();

export function getMemoryDb(workspaceRoot: string, dbPath?: string): Database.Database {
  const fullPath = join(workspaceRoot, dbPath ?? ".yggdrasil/memory.db");
  const cached = dbCache.get(fullPath);
  if (cached) return cached;

  mkdirSync(dirname(fullPath), { recursive: true });

  const database = new Database(fullPath);
  database.pragma("journal_mode = WAL");

  database.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT,
      content TEXT NOT NULL,
      type TEXT DEFAULT 'fact',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      relevance REAL DEFAULT 1.0
    );
    CREATE INDEX IF NOT EXISTS idx_memories_agent ON memories(agent_id);
    CREATE VIRTUAL TABLE IF NOT EXISTS project_index USING fts5(path UNINDEXED, content);
    CREATE TABLE IF NOT EXISTS project_index_meta (
      path TEXT PRIMARY KEY,
      mtime INTEGER NOT NULL
    );
  `);

  dbCache.set(fullPath, database);
  return database;
}

/** With no args, closes every cached db (was this function's old single-db behavior). With `workspaceRoot`, closes and evicts just that one — e.g. app-desktop on a project window closing, so a long-running main process doesn't accumulate an open sqlite handle per project ever opened in the session. */
export function closeMemoryDb(workspaceRoot?: string, dbPath?: string): void {
  if (workspaceRoot === undefined) {
    for (const database of dbCache.values()) database.close();
    dbCache.clear();
    return;
  }
  const fullPath = join(workspaceRoot, dbPath ?? ".yggdrasil/memory.db");
  dbCache.get(fullPath)?.close();
  dbCache.delete(fullPath);
}

export function queryMemories(
  database: Database.Database,
  agentId?: string,
  limit = 20,
): MemoryRow[] {
  const stmt = database.prepare(
    `SELECT * FROM memories
     WHERE (agent_id = ? OR agent_id IS NULL)
     ORDER BY relevance DESC, updated_at DESC
     LIMIT ?`,
  );
  return stmt.all(agentId ?? null, limit) as MemoryRow[];
}

export function addMemory(
  database: Database.Database,
  content: string,
  type = "fact",
  agentId?: string,
): MemoryRow {
  const now = Date.now();
  const stmt = database.prepare(
    `INSERT INTO memories (agent_id, content, type, created_at, updated_at, relevance)
     VALUES (?, ?, ?, ?, ?, 1.0)`,
  );
  const result = stmt.run(agentId ?? null, content, type, now, now);
  return { id: Number(result.lastInsertRowid), agent_id: agentId ?? null, content, type, created_at: now, updated_at: now, relevance: 1.0 };
}

export function removeMemory(database: Database.Database, id: number): boolean {
  const result = database.prepare("DELETE FROM memories WHERE id = ?").run(id);
  return result.changes > 0;
}

export function updateMemory(
  database: Database.Database,
  id: number,
  updates: { content?: string; relevance?: number },
): boolean {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (updates.content !== undefined) { sets.push("content = ?"); vals.push(updates.content); }
  if (updates.relevance !== undefined) { sets.push("relevance = ?"); vals.push(updates.relevance); }
  sets.push("updated_at = ?");
  vals.push(Date.now());
  vals.push(id);
  const result = database.prepare(`UPDATE memories SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  return result.changes > 0;
}

export function listAllMemories(database: Database.Database, agentId?: string, limit = 50): MemoryRow[] {
  if (agentId) {
    return database.prepare("SELECT * FROM memories WHERE agent_id = ? ORDER BY updated_at DESC LIMIT ?").all(agentId, limit) as MemoryRow[];
  }
  return database.prepare("SELECT * FROM memories ORDER BY updated_at DESC LIMIT ?").all(limit) as MemoryRow[];
}

export function searchMemories(database: Database.Database, query: string, agentId?: string, limit = 10): MemoryRow[] {
  const pattern = `%${query}%`;
  if (agentId) {
    return database.prepare(
      "SELECT * FROM memories WHERE (agent_id = ? OR agent_id IS NULL) AND content LIKE ? ORDER BY relevance DESC, updated_at DESC LIMIT ?",
    ).all(agentId, pattern, limit) as MemoryRow[];
  }
  return database.prepare(
    "SELECT * FROM memories WHERE content LIKE ? ORDER BY relevance DESC, updated_at DESC LIMIT ?",
  ).all(pattern, limit) as MemoryRow[];
}
// FTS5 tables have no UNIQUE constraint to hang an upsert off — "path" is
// only UNINDEXED, not a key, so a plain "INSERT OR REPLACE" never actually
// conflicts with anything and just inserts a new row every time, leaving
// the old (stale) content for that path silently searchable forever.
// Deleting any existing row for this path first is what makes "replace" by
// path actually true.
export function indexProjectFile(database: Database.Database, path: string, content: string): void {
  database.prepare("DELETE FROM project_index WHERE path = ?").run(path);
  database.prepare("INSERT INTO project_index (path, content) VALUES (?, ?)").run(path, content);
}

// A plugin's storage value is arbitrary JSON (a kanban board, or whatever
// shape a future plugin invents) — this has no schema to key off, so it just
// walks every string/number/boolean it finds and joins them as "key: value"
// lines, recursing into objects/arrays. Depth-capped so a pathological
// self-referential-looking structure (or just a deep one) can't spin forever;
// six levels comfortably covers a kanban board's
// columns→cards→checklist→items shape with room to spare.
function flattenJsonToText(value: unknown, depth = 0): string {
  if (depth > 6 || value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((v) => flattenJsonToText(v, depth + 1))
      .filter(Boolean)
      .join("\n");
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, v]) => {
        const text = flattenJsonToText(v, depth + 1);
        return text ? `${key}: ${text}` : "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/**
 * Indexes (or, if now-empty, de-indexes) one plugin storage key — the
 * per-write hook a host app calls right after `ygg.storage.set` so the
 * index stays live without a background walk. `path` follows
 * `plugin:<scope>:<pluginId>:<storageKey>` so a project_search hit's path
 * tells the caller exactly which plugin/key it came from, same spirit as a
 * real file path.
 */
export function indexPluginStorageKey(
  database: Database.Database,
  scope: string,
  pluginId: string,
  storageKey: string,
  value: unknown,
): void {
  const path = `plugin:${scope}:${pluginId}:${storageKey}`;
  const text = flattenJsonToText(value);
  if (!text.trim()) {
    database.prepare("DELETE FROM project_index WHERE path = ?").run(path);
    return;
  }
  indexProjectFile(database, path, text);
}

/**
 * Full pass over every plugin's storage file (global + this project's own)
 * — run once when a project window opens so a plugin's pre-existing data is
 * searchable immediately, without waiting for its next write to trigger
 * indexPluginStorageKey. `pluginStorageDir` is the host app's own
 * `<userData>/plugin-storage` root (this package has no Electron dependency
 * itself — see gateway's own use of getMemoryDb — so the caller resolves
 * that path, not this function).
 */
export async function indexAllPluginStorage(
  database: Database.Database,
  pluginStorageDir: string,
  projectId: string,
): Promise<void> {
  const roots: Array<{ scope: string; dir: string }> = [
    { scope: "global", dir: join(pluginStorageDir, "global") },
    { scope: "project", dir: join(pluginStorageDir, "project", projectId) },
  ];
  for (const { scope, dir } of roots) {
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const pluginId = file.slice(0, -".json".length);
      let store: Record<string, unknown>;
      try {
        store = JSON.parse(await readFile(join(dir, file), "utf8")) as Record<string, unknown>;
      } catch {
        continue;
      }
      for (const [storageKey, value] of Object.entries(store)) {
        indexPluginStorageKey(database, scope, pluginId, storageKey, value);
      }
    }
  }
}

// Raw user/model input must never reach FTS5's MATCH as query syntax — a
// bare hyphen, colon, asterisk, or keyword like NOT/AND is meaningful there,
// not literal. Wrapping the whole input as a quoted phrase (doubling any
// embedded quotes, FTS5's own escape rule) makes every character literal,
// which is what both callers actually want ("find files matching this
// text"). Confirmed against a real index: an unescaped hyphenated query
// like `restore-inventory` throws "no such column: inventory" — extremely
// common in practice since filenames/skill names are usually hyphenated.
function toFts5Phrase(query: string): string {
  return `"${query.replace(/"/g, '""')}"`;
}

export function searchProjectFiles(database: Database.Database, query: string, limit = 10): { path: string, content: string }[] {
  return database.prepare(`
    SELECT path, snippet(project_index, 1, '<b>', '</b>', '...', 20) as content
    FROM project_index
    WHERE project_index MATCH ?
    LIMIT ?
  `).all(toFts5Phrase(query), limit) as { path: string, content: string }[];
}

function getIndexedMtime(database: Database.Database, path: string): number | undefined {
  const row = database.prepare("SELECT mtime FROM project_index_meta WHERE path = ?").get(path) as
    | { mtime: number }
    | undefined;
  return row?.mtime;
}

function setIndexedMtime(database: Database.Database, path: string, mtime: number): void {
  database.prepare("INSERT OR REPLACE INTO project_index_meta (path, mtime) VALUES (?, ?)").run(path, mtime);
}

// Only paths this walk itself indexed and is tracking mtimes for — not
// project_index as a whole, which can also hold entries the project_index
// tool indexed manually (arbitrary agent-supplied path/content, not
// necessarily a real file under root). Using this as the "did this run see
// it" set means a stale-cleanup pass below never touches those.
function listWalkedPaths(database: Database.Database): string[] {
  return (database.prepare("SELECT path FROM project_index_meta").all() as { path: string }[]).map((r) => r.path);
}

function deleteFromIndex(database: Database.Database, path: string): void {
  database.prepare("DELETE FROM project_index WHERE path = ?").run(path);
  database.prepare("DELETE FROM project_index_meta WHERE path = ?").run(path);
}

// Common source/doc extensions across the ecosystems this tool is likely to
// see. Deliberately excludes .json/.yaml/.yml and lockfiles: those are
// usually generated/data (package-lock.json, pnpm-lock.yaml can be
// megabytes) rather than "content" worth full-text search, and .gitignore
// doesn't reliably exclude them since they're normally committed. Override
// via the plugin's own config (`extensions: string[]`, see index.ts) if a
// project wants a different set — passing one replaces this default
// entirely rather than extending it.
export const DEFAULT_INDEXABLE_EXTENSIONS = [
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".kt", ".rb", ".php",
  ".c", ".cc", ".cpp", ".h", ".hpp", ".cs", ".swift",
  ".css", ".scss", ".html", ".sh",
  ".md", ".mdx",
];

function isIndexableFile(name: string, extensions: string[]): boolean {
  return extensions.some((ext) => name.endsWith(ext));
}

// Cheap pre-pass (readdir only — no stat, no read) just to learn how many
// files this run will actually walk, so progress can report a real
// processed/total instead of a guess. Only worth the extra directory pass
// when someone's actually listening (see indexAllFiles below).
async function countEligibleFiles(root: string, ig: IgnoreMatcher, extensions: string[]): Promise<number> {
  let count = 0;
  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (ig.ignores(toIgnoreTestPath(root, fullPath))) continue;
      if (entry.isDirectory()) await walk(fullPath);
      else if (isIndexableFile(entry.name, extensions)) count++;
    }
  }
  await walk(root);
  return count;
}

export type IndexProgress = { processed: number; total: number };

// Incremental: a file whose mtime matches what's already indexed is skipped
// (no re-read, no FTS5 rewrite) — on a large repo, repeat runs after the
// first only touch what actually changed. Files removed or renamed since
// the last run are dropped from the index too, so it doesn't accumulate
// ghosts for paths that no longer exist. Directories/files matched by the
// project's .gitignore (plus .git/.yggdrasil/node_modules, always excluded
// — see ignoreMatcher.ts) are skipped entirely rather than walked.
//
// `onProgress`, if given, is called as files are walked (throttled to
// roughly 10/sec so a huge repo doesn't fire thousands of events) with a
// real processed/total count — "processed" advances for every eligible
// file the walk reaches, skipped-as-unchanged included, since that's what
// tracks actual walk progress; a final call with processed === total is
// guaranteed once the walk finishes.
export async function indexAllFiles(
  database: Database.Database,
  root: string,
  onProgress?: (progress: IndexProgress) => void,
  extensions: string[] = DEFAULT_INDEXABLE_EXTENSIONS,
): Promise<void> {
  const ig = await loadIgnoreMatcher(root);
  const total = onProgress ? await countEligibleFiles(root, ig, extensions) : 0;
  const seen = new Set<string>();
  let processed = 0;
  let lastEmitAt = 0;

  function reportProgress(force: boolean) {
    if (!onProgress) return;
    const now = Date.now();
    if (!force && now - lastEmitAt < 100) return;
    lastEmitAt = now;
    onProgress({ processed, total });
  }

  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (ig.ignores(toIgnoreTestPath(root, fullPath))) continue;

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (isIndexableFile(entry.name, extensions)) {
        seen.add(fullPath);
        const mtime = Math.trunc((await stat(fullPath)).mtimeMs);
        if (getIndexedMtime(database, fullPath) !== mtime) {
          const content = await readFile(fullPath, "utf8");
          indexProjectFile(database, fullPath, content);
          setIndexedMtime(database, fullPath, mtime);
        }
        processed++;
        reportProgress(false);
      }
    }
  }
  await walk(root);
  reportProgress(true);

  for (const path of listWalkedPaths(database)) {
    if (!seen.has(path)) deleteFromIndex(database, path);
  }
}

/**
 * Reconciles a single path — used by watch.ts's chokidar handler (auto-
 * reindex on save) instead of `indexAllFiles` re-walking the whole project
 * on every edit. Not extension-filtered by the caller: a non-indexable path
 * (or one outside the ignore matcher's scope, which watch.ts's `ignored`
 * option already keeps out of the watcher entirely) is just a no-op here.
 */
export async function indexSinglePath(
  database: Database.Database,
  root: string,
  relPath: string,
  extensions: string[] = DEFAULT_INDEXABLE_EXTENSIONS,
): Promise<void> {
  if (!isIndexableFile(relPath, extensions)) return;
  const fullPath = join(root, relPath);
  try {
    const mtime = Math.trunc((await stat(fullPath)).mtimeMs);
    if (getIndexedMtime(database, fullPath) === mtime) return;
    const content = await readFile(fullPath, "utf8");
    indexProjectFile(database, fullPath, content);
    setIndexedMtime(database, fullPath, mtime);
  } catch (err) {
    // The watcher noticed this path (add/change/unlink all route here) but
    // it's gone by the time we got to it — drop any stale entry instead of
    // leaving a ghost, same as indexAllFiles's own cleanup pass.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") deleteFromIndex(database, fullPath);
    else throw err;
  }
}
