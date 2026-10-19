import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type ResourceType = "plugin-storage-key" | "notes-file";
export type Role = "edit" | "view";

export type ShareRow = {
  id: string;
  resource_type: ResourceType;
  resource_key: string;
  owner_name: string;
  owner_key_hash: string;
  created_at: number;
  content: string;
  version: number;
};

export type MemberRow = {
  share_id: string;
  key_hash: string;
  member_name: string;
  role: Role;
  invited_at: number;
  email: string | null;
  kind: "app" | "web";
};

export type InviteRow = {
  code: string;
  share_id: string;
  role: Role;
  created_at: number;
  expires_at: number | null;
  redeemed_at: number | null;
  redeemed_by_name: string | null;
};

let db: Database.Database | null = null;

// Single-process singleton — Railway runs this as one instance, and
// better-sqlite3 is synchronous, so there's no cross-request race to guard
// against beyond what SQLite's own locking already gives us.
export function getDb(dbPath: string): Database.Database {
  if (db) return db;

  mkdirSync(dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS shares (
      id TEXT PRIMARY KEY,
      resource_type TEXT NOT NULL,
      resource_key TEXT NOT NULL,
      owner_name TEXT NOT NULL,
      owner_key_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      content TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS share_members (
      share_id TEXT NOT NULL REFERENCES shares(id),
      key_hash TEXT NOT NULL,
      member_name TEXT NOT NULL,
      role TEXT NOT NULL,
      invited_at INTEGER NOT NULL,
      PRIMARY KEY (share_id, key_hash)
    );
    CREATE TABLE IF NOT EXISTS invites (
      code TEXT PRIMARY KEY,
      share_id TEXT NOT NULL REFERENCES shares(id),
      role TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER,
      redeemed_at INTEGER,
      redeemed_by_name TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_members_key_hash ON share_members(key_hash);
    CREATE INDEX IF NOT EXISTS idx_shares_owner ON shares(owner_key_hash);
    CREATE TABLE IF NOT EXISTS share_bundles (
      share_id TEXT PRIMARY KEY REFERENCES shares(id),
      files_json TEXT NOT NULL,
      project_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // Added after the first deploy — SQLite has no ADD COLUMN IF NOT EXISTS,
  // so check the live schema instead of try/catching a duplicate-column error.
  const memberColumns = new Set(
    (db.prepare("PRAGMA table_info(share_members)").all() as { name: string }[]).map((c) => c.name),
  );
  if (!memberColumns.has("email")) db.exec("ALTER TABLE share_members ADD COLUMN email TEXT");
  // 'app' = redeemed an invite code from the desktop app; 'web' = a browser
  // link created by the owner, gated by an email check (see routes.ts).
  if (!memberColumns.has("kind")) db.exec("ALTER TABLE share_members ADD COLUMN kind TEXT NOT NULL DEFAULT 'app'");

  return db;
}

export type BundleRow = { share_id: string; files_json: string; project_json: string; updated_at: number };

export function getBundle(database: Database.Database, shareId: string): BundleRow | undefined {
  return database.prepare("SELECT * FROM share_bundles WHERE share_id = ?").get(shareId) as BundleRow | undefined;
}

export function getMember(database: Database.Database, shareId: string, keyHash: string): MemberRow | undefined {
  return database
    .prepare("SELECT * FROM share_members WHERE share_id = ? AND key_hash = ?")
    .get(shareId, keyHash) as MemberRow | undefined;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function closeDb(): void {
  db?.close();
  db = null;
}

export type Access = { role: "owner" | Role };

// Owner counts as edit-capable everywhere a Role is checked; callers that
// need to tell "owner" apart (e.g. member-revocation) check role === "owner"
// explicitly instead of relying on this being narrowed away.
export function findAccess(database: Database.Database, shareId: string, keyHash: string): Access | null {
  const share = database.prepare("SELECT * FROM shares WHERE id = ?").get(shareId) as ShareRow | undefined;
  if (!share) return null;
  if (share.owner_key_hash === keyHash) return { role: "owner" };
  const member = database
    .prepare("SELECT * FROM share_members WHERE share_id = ? AND key_hash = ?")
    .get(shareId, keyHash) as MemberRow | undefined;
  if (!member) return null;
  return { role: member.role };
}

export function getShare(database: Database.Database, shareId: string): ShareRow | undefined {
  return database.prepare("SELECT * FROM shares WHERE id = ?").get(shareId) as ShareRow | undefined;
}

export function sharesForKeyHash(database: Database.Database, keyHash: string): (ShareRow & { role: string; memberCount: number })[] {
  const rows = database
    .prepare(
      `SELECT s.*, 'owner' as role FROM shares s WHERE s.owner_key_hash = ?
       UNION ALL
       SELECT s.*, m.role as role FROM shares s
       JOIN share_members m ON m.share_id = s.id
       WHERE m.key_hash = ?`,
    )
    .all(keyHash, keyHash) as (ShareRow & { role: string })[];

  const countStmt = database.prepare("SELECT COUNT(*) as n FROM share_members WHERE share_id = ?");
  return rows.map((row) => ({
    ...row,
    memberCount: (countStmt.get(row.id) as { n: number }).n,
  }));
}
