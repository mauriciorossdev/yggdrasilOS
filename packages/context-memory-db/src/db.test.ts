import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getMemoryDb,
  closeMemoryDb,
  addMemory,
  removeMemory,
  updateMemory,
  listAllMemories,
  searchMemories,
  queryMemories,
  indexAllFiles,
  searchProjectFiles,
  indexSinglePath,
} from "./db.js";

describe("context-memory-db", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "memory-db-"));
  });

  afterEach(() => {
    closeMemoryDb();
    rmSync(root, { recursive: true, force: true });
  });

  it("creates the sqlite file under .yggdrasil/memory.db and starts empty", () => {
    const db = getMemoryDb(root);
    expect(listAllMemories(db)).toEqual([]);
  });

  it("adds a memory and can list it back", () => {
    const db = getMemoryDb(root);
    const row = addMemory(db, "the sky is blue", "fact");
    expect(row.id).toBeGreaterThan(0);

    const rows = listAllMemories(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.content).toBe("the sky is blue");
    expect(rows[0]!.type).toBe("fact");
  });

  it("scopes queryMemories to a given agentId plus global (null-agent) memories", () => {
    const db = getMemoryDb(root);
    addMemory(db, "global memory", "fact");
    addMemory(db, "agent-a memory", "fact", "agent-a");
    addMemory(db, "agent-b memory", "fact", "agent-b");

    const rows = queryMemories(db, "agent-a");
    const contents = rows.map((r) => r.content).sort();
    expect(contents).toEqual(["agent-a memory", "global memory"]);
  });

  it("updates a memory's content", () => {
    const db = getMemoryDb(root);
    const row = addMemory(db, "old content");
    const ok = updateMemory(db, row.id, { content: "new content" });
    expect(ok).toBe(true);

    const rows = listAllMemories(db);
    expect(rows[0]!.content).toBe("new content");
  });

  it("removes a memory by id", () => {
    const db = getMemoryDb(root);
    const row = addMemory(db, "to be deleted");
    expect(removeMemory(db, row.id)).toBe(true);
    expect(listAllMemories(db)).toEqual([]);
    expect(removeMemory(db, row.id)).toBe(false);
  });

  it("searches memories by content substring", () => {
    const db = getMemoryDb(root);
    addMemory(db, "likes pizza");
    addMemory(db, "likes pasta");
    addMemory(db, "dislikes olives");

    const rows = searchMemories(db, "likes");
    expect(rows.map((r) => r.content).sort()).toEqual(["dislikes olives", "likes pasta", "likes pizza"]);

    const narrower = searchMemories(db, "pizza");
    expect(narrower).toHaveLength(1);
  });

  it("incrementally indexes: skips unchanged mtimes, reindexes on change, drops deleted files", async () => {
    const db = getMemoryDb(root);
    const filePath = join(root, "a.ts");
    const originalMtime = new Date("2024-01-01T00:00:00Z");
    writeFileSync(filePath, "alpha content");
    utimesSync(filePath, originalMtime, originalMtime);

    await indexAllFiles(db, root);
    expect(searchProjectFiles(db, "alpha").map((r) => r.path)).toEqual([filePath]);

    // Content changed on disk but mtime didn't — skipped, so the old content
    // is still what's searchable.
    writeFileSync(filePath, "mutated content");
    utimesSync(filePath, originalMtime, originalMtime);
    await indexAllFiles(db, root);
    expect(searchProjectFiles(db, "mutated")).toHaveLength(0);
    expect(searchProjectFiles(db, "alpha")).toHaveLength(1);

    // Bumping mtime is what actually triggers a re-read + reindex.
    const laterMtime = new Date("2024-01-02T00:00:00Z");
    utimesSync(filePath, laterMtime, laterMtime);
    await indexAllFiles(db, root);
    expect(searchProjectFiles(db, "mutated")).toHaveLength(1);
    expect(searchProjectFiles(db, "alpha")).toHaveLength(0);

    // Deleting the file and reindexing drops it from the index instead of
    // leaving a stale ghost entry behind.
    unlinkSync(filePath);
    await indexAllFiles(db, root);
    expect(searchProjectFiles(db, "mutated")).toHaveLength(0);
  });

  it("respects .gitignore and always skips node_modules, even without one", async () => {
    const db = getMemoryDb(root);

    writeFileSync(join(root, ".gitignore"), "dist/\n*.generated.ts\n");
    mkdirSync(join(root, "dist"), { recursive: true });
    writeFileSync(join(root, "dist", "bundle.ts"), "gitignored dist content");
    writeFileSync(join(root, "schema.generated.ts"), "gitignored pattern content");

    mkdirSync(join(root, "node_modules", "some-dep"), { recursive: true });
    writeFileSync(join(root, "node_modules", "some-dep", "index.ts"), "node_modules content");

    writeFileSync(join(root, "kept.ts"), "kept content");

    await indexAllFiles(db, root);

    expect(searchProjectFiles(db, "kept")).toHaveLength(1);
    expect(searchProjectFiles(db, "gitignored")).toHaveLength(0);
    expect(searchProjectFiles(db, "node_modules")).toHaveLength(0);
  });

  it("reports real processed/total progress, ending at the actual file count", async () => {
    const db = getMemoryDb(root);
    writeFileSync(join(root, "one.ts"), "one");
    writeFileSync(join(root, "two.ts"), "two");
    writeFileSync(join(root, "three.md"), "three");
    // Not indexable (wrong extension) — shouldn't count toward total.
    writeFileSync(join(root, "four.json"), "{}");

    const calls: { processed: number; total: number }[] = [];
    await indexAllFiles(db, root, (progress) => calls.push({ ...progress }));

    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.total === 3)).toBe(true);
    const last = calls[calls.length - 1]!;
    expect(last.processed).toBe(3);
  });

  it("the default extension list now covers common non-TS/JS languages too", async () => {
    const db = getMemoryDb(root);
    writeFileSync(join(root, "script.py"), "pythonic content");
    writeFileSync(join(root, "main.go"), "golang content");
    writeFileSync(join(root, "styles.scss"), "scssy content");
    // Still excluded by default — see DEFAULT_INDEXABLE_EXTENSIONS's comment.
    writeFileSync(join(root, "data.json"), '{"jsony": true}');

    await indexAllFiles(db, root);

    expect(searchProjectFiles(db, "pythonic")).toHaveLength(1);
    expect(searchProjectFiles(db, "golang")).toHaveLength(1);
    expect(searchProjectFiles(db, "scssy")).toHaveLength(1);
    expect(searchProjectFiles(db, "jsony")).toHaveLength(0);
  });

  it("a custom extensions list replaces the default instead of extending it", async () => {
    const db = getMemoryDb(root);
    writeFileSync(join(root, "included.json"), '{"onlyme": true}');
    writeFileSync(join(root, "excluded.ts"), "not in the custom list");

    await indexAllFiles(db, root, undefined, [".json"]);

    expect(searchProjectFiles(db, "onlyme")).toHaveLength(1);
    expect(searchProjectFiles(db, "excluded")).toHaveLength(0);
  });

  describe("indexSinglePath (watch.ts's per-save reconciliation)", () => {
    it("indexes a new/changed file and drops a deleted one", async () => {
      const db = getMemoryDb(root);
      const filePath = join(root, "watched.ts");

      writeFileSync(filePath, "first save content");
      utimesSync(filePath, new Date("2024-01-01T00:00:00Z"), new Date("2024-01-01T00:00:00Z"));
      await indexSinglePath(db, root, "watched.ts");
      expect(searchProjectFiles(db, "first")).toHaveLength(1);

      // Force a distinct mtime rather than relying on two writeFileSync
      // calls landing in different milliseconds — on a fast filesystem
      // they can easily land in the same one, which would (correctly)
      // make indexSinglePath treat this as unchanged and skip it.
      writeFileSync(filePath, "second save content");
      utimesSync(filePath, new Date("2024-01-02T00:00:00Z"), new Date("2024-01-02T00:00:00Z"));
      await indexSinglePath(db, root, "watched.ts");
      expect(searchProjectFiles(db, "second")).toHaveLength(1);
      expect(searchProjectFiles(db, "first")).toHaveLength(0);

      unlinkSync(filePath);
      await indexSinglePath(db, root, "watched.ts");
      expect(searchProjectFiles(db, "second")).toHaveLength(0);
    });

    it("no-ops for a non-indexable extension", async () => {
      const db = getMemoryDb(root);
      writeFileSync(join(root, "notes.txt"), "should never be indexed");
      await indexSinglePath(db, root, "notes.txt");
      expect(searchProjectFiles(db, "should")).toHaveLength(0);
    });

    it("no-ops for a path that never existed (no throw)", async () => {
      const db = getMemoryDb(root);
      await expect(indexSinglePath(db, root, "never-existed.ts")).resolves.toBeUndefined();
    });
  });
});
