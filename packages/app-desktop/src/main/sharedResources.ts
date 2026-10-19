import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app } from "electron";
import type { PluginScope } from "./plugins.js";

export type SharedResourceType = "plugin-storage-key" | "notes-file";
export type SharedResourceRole = "edit" | "view";

/**
 * One local record per resource this machine has shared or joined. `resourceKey`
 * is the same opaque string handed to the sync-server (see resourceKeyFor
 * below) and is this registry's own lookup key — a given local plugin-storage
 * key or notes/ file can only be attached to one remote share at a time.
 * `apiKey` is whichever credential this machine holds for that share: the
 * account-wide owner key (shares this machine created) or a per-share member
 * key (shares this machine joined via an invite).
 */
export type SharedResource = {
  resourceKey: string;
  shareId: string;
  resourceType: SharedResourceType;
  role: SharedResourceRole;
  apiKey: string;
  localVersion: number;
  conflict?: boolean;
  projectId: string;
  // plugin-storage-key only
  scope?: PluginScope;
  pluginId?: string;
  storageKey?: string;
  // notes-file only
  relativePath?: string;
};

export function pluginResourceKey(scope: PluginScope, projectId: string, pluginId: string, storageKey: string): string {
  return scope === "global"
    ? `plugin:global:${pluginId}:${storageKey}`
    : `plugin:project:${projectId}:${pluginId}:${storageKey}`;
}

export function notesResourceKey(projectId: string, relativePath: string): string {
  return `notes:${projectId}:${relativePath}`;
}

/** What the renderer sends over IPC to address a resource — deliberately the same shape as SharedResource's own local-addressing fields (see syncEngine.ts's *ForResource helpers), so main can both compute the lookup key and, on first share, know how to read/write the resource locally. */
export type ResourceRef =
  | { resourceType: "notes-file"; projectId: string; relativePath: string }
  | { resourceType: "plugin-storage-key"; projectId: string; scope: PluginScope; pluginId: string; storageKey: string };

export function resourceKeyFor(ref: ResourceRef): string {
  return ref.resourceType === "notes-file"
    ? notesResourceKey(ref.projectId, ref.relativePath)
    : pluginResourceKey(ref.scope, ref.projectId, ref.pluginId, ref.storageKey);
}

let queue: Promise<unknown> = Promise.resolve();

function chain<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function registryPath(): string {
  return join(app.getPath("userData"), "shared-resources.json");
}

async function readAll(): Promise<Record<string, SharedResource>> {
  try {
    return JSON.parse(await readFile(registryPath(), "utf8")) as Record<string, SharedResource>;
  } catch {
    return {};
  }
}

async function writeAll(data: Record<string, SharedResource>): Promise<void> {
  const path = registryPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2), "utf8");
}

export function listSharedResources(): Promise<SharedResource[]> {
  return chain(async () => Object.values(await readAll()));
}

export function getSharedResource(resourceKey: string): Promise<SharedResource | undefined> {
  return chain(async () => (await readAll())[resourceKey]);
}

export function upsertSharedResource(resource: SharedResource): Promise<void> {
  return chain(async () => {
    const all = await readAll();
    all[resource.resourceKey] = resource;
    await writeAll(all);
  });
}

export function removeSharedResource(resourceKey: string): Promise<void> {
  return chain(async () => {
    const all = await readAll();
    delete all[resourceKey];
    await writeAll(all);
  });
}

export function updateSharedResource(
  resourceKey: string,
  patch: Partial<Pick<SharedResource, "localVersion" | "conflict" | "apiKey" | "role">>,
): Promise<SharedResource | undefined> {
  return chain(async () => {
    const all = await readAll();
    const existing = all[resourceKey];
    if (!existing) return undefined;
    const next = { ...existing, ...patch };
    all[resourceKey] = next;
    await writeAll(all);
    return next;
  });
}
