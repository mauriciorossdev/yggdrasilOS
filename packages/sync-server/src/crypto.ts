import { randomBytes, randomUUID, createHash } from "node:crypto";

export function generateId(): string {
  return randomUUID();
}

// Raw secret handed to a client (owner key or a redeemed member key) — shown
// once, never stored in plaintext server-side (see hashKey).
export function generateApiKey(): string {
  return `ygs_${randomBytes(24).toString("base64url")}`;
}

// Deliberately short — this is pasted by hand into a chat message, not typed
// as a password. base64url keeps it URL-safe if it's ever wrapped in a link.
export function generateInviteCode(): string {
  return randomBytes(9).toString("base64url");
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
