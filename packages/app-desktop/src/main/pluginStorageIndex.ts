import { join } from "node:path";
import { app } from "electron";
import { getMemoryDb, indexAllPluginStorage, indexPluginStorageKey } from "@yggdrasil/context-memory-db";
import type { PluginScope } from "./plugins.js";

function pluginStorageRootDir(): string {
  return join(app.getPath("userData"), "plugin-storage");
}

/**
 * Full pass over every installed plugin's storage (global + this project's
 * own) into this project's own `.yggdrasil/memory.db` — called once when a
 * project window opens (main/index.ts's openProject) so pre-existing plugin
 * data is searchable via `plugin_data_search` immediately, without waiting
 * for a write to trigger indexPluginStorageKey below.
 */
export async function reindexAllPluginStorage(projectPath: string, projectId: string): Promise<void> {
  const db = getMemoryDb(projectPath);
  await indexAllPluginStorage(db, pluginStorageRootDir(), projectId);
}

/**
 * Called right after a `plugins:storageSet`/`storageDelete` IPC handler
 * writes locally — keeps the index live without a background watcher.
 * `value: undefined` (storageDelete) de-indexes the key.
 */
export function indexPluginStorageOnWrite(projectPath: string, scope: PluginScope, pluginId: string, storageKey: string, value: unknown): void {
  const db = getMemoryDb(projectPath);
  indexPluginStorageKey(db, scope, pluginId, storageKey, value);
}
