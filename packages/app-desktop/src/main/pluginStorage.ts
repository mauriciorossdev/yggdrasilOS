import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app } from "electron";
import type { PluginScope } from "./plugins.js";

/**
 * Plain per-plugin JSON storage — `ygg.storage.*` in the SDK. One file per
 * plugin, chained through a promise queue (same shape as settingsFile.ts's
 * updateSettingsFile) so two overlapping calls against the same file never
 * interleave at the OS level or lose an update. Global plugins are keyed
 * only by id (shared across every project window); project plugins are
 * additionally keyed by projectId, so the same plugin id in two different
 * projects never shares state.
 */
let queue: Promise<unknown> = Promise.resolve();

function chain<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function storagePath(scope: PluginScope, id: string, projectId: string): string {
  const base = join(app.getPath("userData"), "plugin-storage");
  return scope === "global" ? join(base, "global", `${id}.json`) : join(base, "project", projectId, `${id}.json`);
}

async function readStore(path: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function writeStore(path: string, data: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2), "utf8");
}

export function pluginStorageGet(scope: PluginScope, id: string, projectId: string, key: string): Promise<unknown> {
  const path = storagePath(scope, id, projectId);
  return chain(async () => (await readStore(path))[key] ?? null);
}

export function pluginStorageSet(
  scope: PluginScope,
  id: string,
  projectId: string,
  key: string,
  value: unknown,
): Promise<void> {
  const path = storagePath(scope, id, projectId);
  return chain(async () => {
    const store = await readStore(path);
    store[key] = value;
    await writeStore(path, store);
  });
}

export function pluginStorageDelete(scope: PluginScope, id: string, projectId: string, key: string): Promise<void> {
  const path = storagePath(scope, id, projectId);
  return chain(async () => {
    const store = await readStore(path);
    delete store[key];
    await writeStore(path, store);
  });
}

export function pluginStorageKeys(scope: PluginScope, id: string, projectId: string): Promise<string[]> {
  const path = storagePath(scope, id, projectId);
  return chain(async () => Object.keys(await readStore(path)));
}
