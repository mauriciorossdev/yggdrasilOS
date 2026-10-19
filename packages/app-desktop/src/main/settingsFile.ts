import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

/**
 * A single JSON file (desktop-settings.json) holds every locally-configured
 * feature that doesn't go through the gateway's config.patch RPC — right now
 * just whisper/stt (see whisperSettings.ts). Every read and write goes
 * through this one queue, chained so only one is ever in flight against the
 * file at a time — two independent unsynchronized read-modify-write cycles
 * against the same file (e.g. two settings sections saving at once) can
 * otherwise interleave at the OS level and corrupt it, or silently lose
 * whichever wrote first ("lost update").
 */
let queue: Promise<unknown> = Promise.resolve();

function settingsPath(userDataDir: string): string {
  return join(userDataDir, "desktop-settings.json");
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
