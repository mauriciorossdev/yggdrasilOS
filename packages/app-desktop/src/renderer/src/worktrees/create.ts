export const MAX_FANOUT = 8;

/**
 * Names for a fan-out: one worktree gets the name as typed; several get
 * `<name>-a`, `<name>-b`, ... so the same task can run side by side.
 */
export function planWorktrees(name: string, count: number): string[] {
  const n = Math.min(Math.max(Math.floor(count) || 1, 1), MAX_FANOUT);
  const base = name.trim();
  if (n === 1) return [base];
  return Array.from({ length: n }, (_, i) => `${base}-${String.fromCharCode(97 + i)}`);
}

/** The gateway wraps failures as "CODE: method: message"; show just the message. */
export function cleanGatewayError(message: string): string {
  return message.replace(/^[A-Z][A-Z_]+:\s*/, "").replace(/^git\.\w+:\s*/, "");
}

/** Free text (a node name) as a worktree name: lower-case letters, digits, '.', '_' and '-'; "" when nothing usable is left. */
export function slugifyWorktreeName(text: string): string {
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
    .replace(/\.{2,}/g, ".")
    .slice(0, 48);
  return slug.endsWith(".lock") ? slug.slice(0, -5) : slug;
}
