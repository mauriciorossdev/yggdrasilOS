import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { format } from "node:util";

/**
 * One log file per app session: <userData>/logs/avatar-<start>-<pid>.log.
 * Each line is a JSON object ({ t, kind, ... }) so the files can be grepped
 * or loaded later. console.log/warn/error are mirrored into the same file.
 */
const MAX_SESSIONS = 30;
const PREFIX = "avatar-";

let file: string | null = null;

export function initSessionLog(userDataDir: string, version: string): string {
  const dir = join(userDataDir, "logs");
  mkdirSync(dir, { recursive: true });
  const started = new Date().toISOString().replace(/[:.]/g, "-");
  file = join(dir, `${PREFIX}${started}-${process.pid}.log`);
  pruneOldSessions(dir);
  mirrorConsole();
  logEvent("session.start", { pid: process.pid, version, platform: process.platform, file });
  return file;
}

export function logEvent(kind: string, data: Record<string, unknown> = {}): void {
  write({ t: new Date().toISOString(), kind, ...data });
}

export function logError(kind: string, err: unknown, data: Record<string, unknown> = {}): void {
  const error = err instanceof Error ? err : new Error(String(err));
  logEvent(kind, { ...data, error: error.message, stack: error.stack });
}

function write(entry: Record<string, unknown>): void {
  if (!file) return;
  try {
    appendFileSync(file, `${JSON.stringify(entry)}\n`);
  } catch {
    // A full disk or a removed folder must not take the app down with it.
  }
}

function mirrorConsole(): void {
  for (const level of ["log", "warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      write({ t: new Date().toISOString(), kind: `console.${level}`, msg: format(...args) });
    };
  }
}

function pruneOldSessions(dir: string): void {
  const sessions = readdirSync(dir)
    .filter((name) => name.startsWith(PREFIX) && name.endsWith(".log"))
    .sort()
    .reverse();
  for (const name of sessions.slice(MAX_SESSIONS - 1)) {
    try {
      unlinkSync(join(dir, name));
    } catch {
      // Already gone, or in use; the next session tries again.
    }
  }
}
