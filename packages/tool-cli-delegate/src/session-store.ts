import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type DelegateCli = "claude" | "agy";

/**
 * "__continue__" is a sentinel meaning: we don't have (or couldn't capture)
 * a real conversation id for this CLI, so future calls should resume via
 * that CLI's own "most recent conversation" flag (`-c/--continue`) instead
 * of an explicit id. Only `agy` can end up here — `claude` always gets an
 * id we mint ourselves via `--session-id` before the first spawn.
 */
export type StoredSessionId = string | "__continue__";

type SessionMap = Partial<Record<DelegateCli, StoredSessionId>>;

/**
 * One global file per home-project workspace, not namespaced by the target
 * directory a given task happens to touch — there is exactly one persistent
 * orchestrator chat, and `claude`/`agy` context should follow that single
 * chat across whatever `cwd`/`addDirs` each task passes, not fragment per
 * project. See notes/ plan doc for why this is deliberately global.
 */
function storePath(workspaceRoot: string): string {
  return join(workspaceRoot, ".yggdrasil", "cli-sessions.json");
}

async function readAll(workspaceRoot: string): Promise<SessionMap> {
  try {
    const raw = await readFile(storePath(workspaceRoot), "utf8");
    return JSON.parse(raw) as SessionMap;
  } catch {
    return {};
  }
}

export async function getStoredSessionId(
  workspaceRoot: string,
  cli: DelegateCli,
): Promise<StoredSessionId | undefined> {
  const all = await readAll(workspaceRoot);
  return all[cli];
}

export async function setStoredSessionId(
  workspaceRoot: string,
  cli: DelegateCli,
  sessionId: StoredSessionId,
): Promise<void> {
  const all = await readAll(workspaceRoot);
  all[cli] = sessionId;
  await mkdir(join(workspaceRoot, ".yggdrasil"), { recursive: true });
  await writeFile(storePath(workspaceRoot), JSON.stringify(all, null, 2), "utf8");
}

export async function clearStoredSessionId(workspaceRoot: string, cli: DelegateCli): Promise<void> {
  const all = await readAll(workspaceRoot);
  delete all[cli];
  await mkdir(join(workspaceRoot, ".yggdrasil"), { recursive: true });
  await writeFile(storePath(workspaceRoot), JSON.stringify(all, null, 2), "utf8");
}
