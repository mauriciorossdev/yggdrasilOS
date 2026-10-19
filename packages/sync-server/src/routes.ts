import type { IncomingMessage, ServerResponse } from "node:http";
import type Database from "better-sqlite3";
import { generateApiKey, generateId, generateInviteCode, hashKey } from "./crypto.js";
import {
  findAccess,
  getMember,
  getShare,
  normalizeEmail,
  sharesForKeyHash,
  type Access,
  type ResourceType,
  type Role,
  type ShareRow,
} from "./db.js";
import { bearerToken, HttpError, readJsonBody, requireString, sendJson } from "./http.js";
import type { BundleMeta } from "./web.js";

const RESOURCE_TYPES: ResourceType[] = ["plugin-storage-key", "notes-file"];
const ROLES: Role[] = ["edit", "view"];

// A bundle is a plugin's own top-level static files (index.html, app.js,
// styles.css, ...) — flat names only, so serving one can never escape it.
const BUNDLE_FILE_NAME = /^[A-Za-z0-9._-]+$/;
const MAX_BUNDLE_FILES = 40;

function requireAuth(req: IncomingMessage): string {
  const token = bearerToken(req);
  if (!token) throw new HttpError(401, "Missing bearer token");
  return hashKey(token);
}

function requireOwner(req: IncomingMessage, db: Database.Database, shareId: string): ShareRow {
  const keyHash = requireAuth(req);
  const share = getShare(db, shareId);
  if (!share) throw new HttpError(404, "Share not found");
  if (share.owner_key_hash !== keyHash) throw new HttpError(403, "Only the owner can do this");
  return share;
}

// Email gate for web-link members: the link alone isn't enough, the visitor
// must also type the email the owner created that link for. Not a strong
// secret (no OTP), just a second factor against a casually forwarded link —
// so failed attempts are throttled per link to keep it from being guessed.
const EMAIL_MAX_FAILS = 5;
const EMAIL_LOCK_MS = 15 * 60_000;
const emailFails = new Map<string, { fails: number; lockedUntil: number }>();

function checkEmail(keyHash: string, expected: string | null, presented: string | undefined): void {
  const now = Date.now();
  let entry = emailFails.get(keyHash);
  if (entry && entry.lockedUntil > now) throw new HttpError(429, "too_many_attempts");
  // An expired lock starts a fresh count.
  if (entry && entry.lockedUntil !== 0) entry = undefined;
  if (!presented) throw new HttpError(401, "email_required");
  if (expected && normalizeEmail(presented) === normalizeEmail(expected)) {
    emailFails.delete(keyHash);
    return;
  }
  const fails = (entry?.fails ?? 0) + 1;
  emailFails.set(keyHash, { fails, lockedUntil: fails >= EMAIL_MAX_FAILS ? now + EMAIL_LOCK_MS : 0 });
  throw new HttpError(403, "email_mismatch");
}

function headerEmail(req: IncomingMessage): string | undefined {
  const raw = req.headers["x-share-email"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value ? decodeURIComponent(value) : undefined;
}

// Resolves the caller's access to a share, enforcing the email gate for
// web-link members. Owner and desktop ('app') members are unaffected.
function requireAccess(req: IncomingMessage, db: Database.Database, shareId: string): { share: ShareRow; access: Access } {
  const keyHash = requireAuth(req);
  const share = getShare(db, shareId);
  if (!share) throw new HttpError(404, "Share not found");
  const access = findAccess(db, shareId, keyHash);
  if (!access) throw new HttpError(403, "Not a member of this share");
  if (access.role !== "owner") {
    const member = getMember(db, shareId, keyHash);
    if (member?.kind === "web") checkEmail(keyHash, member.email, headerEmail(req));
  }
  return { share, access };
}

function publicBaseUrl(req: IncomingMessage): string {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, "");
  const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0] ?? "http";
  return `${proto}://${req.headers.host ?? "localhost"}`;
}

// Owner-created (POST /v1/shares) — the presenting key becomes the share's
// owner. There's no separate account-registration step: the desktop app
// generates a random key once (syncSettings.ownerApiKey) and reuses it for
// every share it creates, so the first share it makes is also implicitly
// where that key becomes "an owner key" — nothing to bootstrap server-side.
async function createShare(req: IncomingMessage, res: ServerResponse, db: Database.Database): Promise<void> {
  const ownerKeyHash = requireAuth(req);
  const body = await readJsonBody<{ resourceType?: string; resourceKey?: string; initialContent?: string; ownerName?: string }>(req);
  const resourceType = requireString(body.resourceType, "resourceType");
  const resourceKey = requireString(body.resourceKey, "resourceKey");
  const ownerName = requireString(body.ownerName, "ownerName");
  const initialContent = typeof body.initialContent === "string" ? body.initialContent : "";
  if (!RESOURCE_TYPES.includes(resourceType as ResourceType)) throw new HttpError(400, `resourceType must be one of ${RESOURCE_TYPES.join(", ")}`);

  const id = generateId();
  const now = Date.now();
  db.prepare(
    `INSERT INTO shares (id, resource_type, resource_key, owner_name, owner_key_hash, created_at, content, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
  ).run(id, resourceType, resourceKey, ownerName, ownerKeyHash, now, initialContent);

  sendJson(res, 201, { shareId: id, version: 1 });
}

async function createInvite(req: IncomingMessage, res: ServerResponse, db: Database.Database, shareId: string): Promise<void> {
  const keyHash = requireAuth(req);
  const share = getShare(db, shareId);
  if (!share) throw new HttpError(404, "Share not found");
  if (share.owner_key_hash !== keyHash) throw new HttpError(403, "Only the owner can create invites");

  const body = await readJsonBody<{ role?: string; expiresInHours?: number }>(req);
  const role = requireString(body.role, "role");
  if (!ROLES.includes(role as Role)) throw new HttpError(400, `role must be one of ${ROLES.join(", ")}`);

  const code = generateInviteCode();
  const now = Date.now();
  const expiresAt = typeof body.expiresInHours === "number" && body.expiresInHours > 0 ? now + body.expiresInHours * 3600_000 : null;
  db.prepare(
    `INSERT INTO invites (code, share_id, role, created_at, expires_at, redeemed_at, redeemed_by_name)
     VALUES (?, ?, ?, ?, ?, NULL, NULL)`,
  ).run(code, shareId, role, now, expiresAt);

  sendJson(res, 201, { code });
}

async function redeemInvite(req: IncomingMessage, res: ServerResponse, db: Database.Database, code: string): Promise<void> {
  const invite = db.prepare("SELECT * FROM invites WHERE code = ?").get(code) as
    | { code: string; share_id: string; role: Role; expires_at: number | null; redeemed_at: number | null }
    | undefined;
  if (!invite) throw new HttpError(404, "Invite not found");
  if (invite.redeemed_at) throw new HttpError(409, "Invite already redeemed");
  if (invite.expires_at && invite.expires_at < Date.now()) throw new HttpError(410, "Invite expired");

  const share = getShare(db, invite.share_id);
  if (!share) throw new HttpError(404, "Share no longer exists");

  const body = await readJsonBody<{ memberName?: string }>(req);
  const memberName = requireString(body.memberName, "memberName");

  const apiKey = generateApiKey();
  const keyHash = hashKey(apiKey);
  const now = Date.now();

  db.prepare(
    `INSERT INTO share_members (share_id, key_hash, member_name, role, invited_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(invite.share_id, keyHash, memberName, invite.role, now);
  db.prepare(`UPDATE invites SET redeemed_at = ?, redeemed_by_name = ? WHERE code = ?`).run(now, memberName, code);

  sendJson(res, 200, {
    shareId: share.id,
    resourceType: share.resource_type,
    resourceKey: share.resource_key,
    apiKey,
    role: invite.role,
  });
}

async function getShareContent(req: IncomingMessage, res: ServerResponse, db: Database.Database, shareId: string): Promise<void> {
  const { share, access } = requireAccess(req, db, shareId);

  sendJson(res, 200, {
    content: share.content,
    version: share.version,
    role: access.role === "owner" ? "edit" : access.role,
    resourceType: share.resource_type,
    resourceKey: share.resource_key,
  });
}

async function putShareContent(req: IncomingMessage, res: ServerResponse, db: Database.Database, shareId: string): Promise<void> {
  const { share, access } = requireAccess(req, db, shareId);
  if (access.role === "view") throw new HttpError(403, "This share is read-only for you");

  const body = await readJsonBody<{ content?: string; expectedVersion?: number }>(req);
  const content = requireString(body.content, "content");
  if (typeof body.expectedVersion !== "number") throw new HttpError(400, `"expectedVersion" is required`);

  if (body.expectedVersion !== share.version) {
    sendJson(res, 409, { currentVersion: share.version, currentContent: share.content });
    return;
  }

  const nextVersion = share.version + 1;
  db.prepare(`UPDATE shares SET content = ?, version = ? WHERE id = ?`).run(content, nextVersion, shareId);
  sendJson(res, 200, { version: nextVersion });
}

async function listMyShares(req: IncomingMessage, res: ServerResponse, db: Database.Database): Promise<void> {
  const keyHash = requireAuth(req);
  const shares = sharesForKeyHash(db, keyHash);
  sendJson(
    res,
    200,
    shares.map((s) => ({
      id: s.id,
      resourceType: s.resource_type,
      resourceKey: s.resource_key,
      role: s.role === "owner" ? "edit" : s.role,
      version: s.version,
      memberCount: s.memberCount,
    })),
  );
}

async function revokeMember(req: IncomingMessage, res: ServerResponse, db: Database.Database, shareId: string, targetKeyHash: string): Promise<void> {
  const keyHash = requireAuth(req);
  const share = getShare(db, shareId);
  if (!share) throw new HttpError(404, "Share not found");
  if (share.owner_key_hash !== keyHash) throw new HttpError(403, "Only the owner can revoke members");

  db.prepare(`DELETE FROM share_members WHERE share_id = ? AND key_hash = ?`).run(shareId, targetKeyHash);
  res.writeHead(204).end();
}

// A browser link for someone who doesn't use the desktop app — just another
// member key, handed out inside a URL fragment (never sent to the server in a
// request line, so it stays out of access logs and Referer headers), plus the
// email the visitor must type to get in (see requireAccess).
async function createWebLink(req: IncomingMessage, res: ServerResponse, db: Database.Database, shareId: string): Promise<void> {
  requireOwner(req, db, shareId);
  const body = await readJsonBody<{ email?: string; role?: string }>(req);
  const email = normalizeEmail(requireString(body.email, "email"));
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new HttpError(400, "email looks invalid");
  const role = requireString(body.role, "role");
  if (!ROLES.includes(role as Role)) throw new HttpError(400, `role must be one of ${ROLES.join(", ")}`);

  const apiKey = generateApiKey();
  const keyHash = hashKey(apiKey);
  db.prepare(
    `INSERT INTO share_members (share_id, key_hash, member_name, role, invited_at, email, kind) VALUES (?, ?, ?, ?, ?, ?, 'web')`,
  ).run(shareId, keyHash, email, role, Date.now(), email);

  sendJson(res, 201, { url: `${publicBaseUrl(req)}/w/${shareId}#k=${apiKey}`, keyHash });
}

async function listMembers(req: IncomingMessage, res: ServerResponse, db: Database.Database, shareId: string): Promise<void> {
  requireOwner(req, db, shareId);
  const rows = db
    .prepare("SELECT * FROM share_members WHERE share_id = ? ORDER BY invited_at")
    .all(shareId) as { key_hash: string; member_name: string; email: string | null; role: Role; kind: string; invited_at: number }[];
  sendJson(
    res,
    200,
    rows.map((m) => ({ keyHash: m.key_hash, name: m.member_name, email: m.email, role: m.role, kind: m.kind, invitedAt: m.invited_at })),
  );
}

async function verifyEmail(req: IncomingMessage, res: ServerResponse, db: Database.Database, shareId: string): Promise<void> {
  const keyHash = requireAuth(req);
  const share = getShare(db, shareId);
  const member = share ? getMember(db, shareId, keyHash) : undefined;
  // Same answer for "no such link" and "revoked" — nothing to learn by probing.
  if (!share || !member) throw new HttpError(403, "Link not valid (revoked or wrong)");
  const body = await readJsonBody<{ email?: string }>(req);
  if (member.kind === "web") checkEmail(keyHash, member.email, typeof body.email === "string" ? body.email : undefined);
  sendJson(res, 200, { ok: true, resourceType: share.resource_type, role: member.role });
}

async function putBundle(req: IncomingMessage, res: ServerResponse, db: Database.Database, shareId: string): Promise<void> {
  const share = requireOwner(req, db, shareId);
  if (share.resource_type !== "plugin-storage-key") throw new HttpError(400, "Only plugin shares carry an app bundle");
  const body = await readJsonBody<{
    files?: Record<string, string>;
    project?: { id?: string; name?: string };
    pluginId?: string;
    pluginName?: string;
    storageKey?: string;
  }>(req);
  const files = body.files;
  if (!files || typeof files !== "object") throw new HttpError(400, `"files" is required`);
  const names = Object.keys(files);
  if (!names.includes("index.html")) throw new HttpError(400, "bundle needs an index.html");
  if (names.length > MAX_BUNDLE_FILES) throw new HttpError(400, "too many files");
  for (const name of names) {
    if (!BUNDLE_FILE_NAME.test(name) || name.startsWith(".")) throw new HttpError(400, `bad file name: ${name}`);
    if (typeof files[name] !== "string") throw new HttpError(400, `file ${name} must be a string`);
  }
  // What web.ts's ygg shim hands the plugin from ready() — the owner's own
  // project id matters, since plugins derive their storage key from it
  // (kanban: `kanban_board_${project.id}`).
  const meta: BundleMeta = {
    project: { id: String(body.project?.id ?? ""), name: String(body.project?.name ?? "") },
    pluginId: String(body.pluginId ?? ""),
    pluginName: String(body.pluginName ?? ""),
    storageKey: String(body.storageKey ?? ""),
  };

  db.prepare(
    `INSERT INTO share_bundles (share_id, files_json, project_json, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(share_id) DO UPDATE SET files_json = excluded.files_json, project_json = excluded.project_json, updated_at = excluded.updated_at`,
  ).run(shareId, JSON.stringify(files), JSON.stringify(meta), Date.now());
  res.writeHead(204).end();
}

// Manual routing over a handful of fixed shapes — a real router is overkill
// for 7 endpoints, and keeping this as one readable dispatch table beats
// pulling in a framework dependency for a service this small.
export async function route(req: IncomingMessage, res: ServerResponse, db: Database.Database): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean); // ["v1", "shares", ...]
  const method = req.method ?? "GET";

  if (parts[0] !== "v1") return false;

  if (method === "POST" && parts.length === 2 && parts[1] === "shares") {
    await createShare(req, res, db);
    return true;
  }
  if (method === "POST" && parts.length === 4 && parts[1] === "shares" && parts[3] === "invites") {
    await createInvite(req, res, db, parts[2]);
    return true;
  }
  if (method === "POST" && parts.length === 4 && parts[1] === "shares" && parts[3] === "web-links") {
    await createWebLink(req, res, db, parts[2]);
    return true;
  }
  if (method === "GET" && parts.length === 4 && parts[1] === "shares" && parts[3] === "members") {
    await listMembers(req, res, db, parts[2]);
    return true;
  }
  if (method === "POST" && parts.length === 4 && parts[1] === "shares" && parts[3] === "verify-email") {
    await verifyEmail(req, res, db, parts[2]);
    return true;
  }
  if (method === "PUT" && parts.length === 4 && parts[1] === "shares" && parts[3] === "bundle") {
    await putBundle(req, res, db, parts[2]);
    return true;
  }
  if (method === "POST" && parts.length === 4 && parts[1] === "invites" && parts[3] === "redeem") {
    await redeemInvite(req, res, db, parts[2]);
    return true;
  }
  if (method === "GET" && parts.length === 3 && parts[1] === "shares" && parts[2] === "mine") {
    await listMyShares(req, res, db);
    return true;
  }
  if (method === "GET" && parts.length === 3 && parts[1] === "shares") {
    await getShareContent(req, res, db, parts[2]);
    return true;
  }
  if (method === "PUT" && parts.length === 3 && parts[1] === "shares") {
    await putShareContent(req, res, db, parts[2]);
    return true;
  }
  if (method === "DELETE" && parts.length === 5 && parts[1] === "shares" && parts[3] === "members") {
    await revokeMember(req, res, db, parts[2], parts[4]);
    return true;
  }

  return false;
}
