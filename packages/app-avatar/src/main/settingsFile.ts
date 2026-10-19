import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

/**
 * whisperSettings.ts and piperSettings.ts both read-modify-write the same
 * avatar-settings.json (whisper's fields at the top level, piper's nested
 * under a "piper" key). Running two independent, unsynchronized
 * read-modify-write cycles against the same file concurrently — exactly
 * what happens when Settings' Save button fires both saves via Promise.all —
 * corrupts it: two overlapping writeFile calls can interleave at the OS
 * level, and even without literal byte interleaving, whichever save reads
 * last-but-writes-first silently loses the other's change ("lost update").
 * Confirmed in the wild: a real corrupted file with a stray trailing `}`
 * left over from a shorter write whose tail didn't fully overwrite a longer
 * one's.
 *
 * Fix: every read and write goes through this one queue, chained so only
 * one is ever in flight against the file at a time — callers await the
 * queue rather than the raw fs call.
 */
let queue: Promise<unknown> = Promise.resolve();

function settingsPath(userDataDir: string): string {
  return join(userDataDir, "avatar-settings.json");
}

async function readRaw(userDataDir: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(settingsPath(userDataDir), "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function chain<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task);
  // Swallow so one failed task doesn't permanently break the queue for
  // everything queued after it — each caller still sees its own rejection
  // via the returned (unswallowed) `result`.
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function readSettingsFile(userDataDir: string): Promise<Record<string, unknown>> {
  return chain(() => readRaw(userDataDir));
}

export function updateSettingsFile(
  userDataDir: string,
  mutate: (existing: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  return chain(async () => {
    await mkdir(userDataDir, { recursive: true });
    const existing = await readRaw(userDataDir);
    await writeFile(settingsPath(userDataDir), JSON.stringify(mutate(existing), null, 2), "utf8");
  });
}
