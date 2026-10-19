import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { app } from "electron";
import { resolveWithinNotes } from "@yggdrasil/tool-documents";
import { globalPluginsDir, projectPluginsDir } from "./plugins.js";
import { getProject } from "./projects.js";
import { pluginStorageGet, pluginStorageSet } from "./pluginStorage.js";
import { ensureOwnerApiKey, loadSyncSettings } from "./syncSettings.js";
import {
  getSharedResource,
  notesResourceKey,
  pluginResourceKey,
  updateSharedResource,
  upsertSharedResource,
  type SharedResource,
} from "./sharedResources.js";
import * as syncClient from "./syncClient.js";

async function readLocalContent(resource: SharedResource): Promise<string> {
  if (resource.resourceType === "plugin-storage-key") {
    const value = await pluginStorageGet(resource.scope!, resource.pluginId!, resource.projectId, resource.storageKey!);
    return JSON.stringify(value ?? null);
  }
  const project = await getProject(resource.projectId);
  if (!project) throw new Error("Project no longer exists");
  const absPath = resolveWithinNotes({ workspaceRoot: project.path }, "sync.push", resource.relativePath!);
  return readFile(absPath, "utf8");
}

async function writeLocalContent(resource: SharedResource, content: string): Promise<void> {
  if (resource.resourceType === "plugin-storage-key") {
    let value: unknown;
    try {
      value = JSON.parse(content);
    } catch {
      value = content;
    }
    await pluginStorageSet(resource.scope!, resource.pluginId!, resource.projectId, resource.storageKey!, value);
    return;
  }
  const project = await getProject(resource.projectId);
  if (!project) throw new Error("Project no longer exists");
  const absPath = resolveWithinNotes({ workspaceRoot: project.path }, "sync.pull", resource.relativePath!);
  await writeFile(absPath, content, "utf8");
}

async function serverUrlOrThrow(): Promise<string> {
  const settings = await loadSyncSettings(app.getPath("userData"));
  if (!settings.serverUrl) throw new Error("No sync server configured. Set one in Settings → Compartir.");
  return settings.serverUrl;
}

export type PushResult =
  | { ok: true; version: number }
  | { ok: false; conflict: true; currentVersion: number }
  | { ok: false; error: string };

export async function pushResource(resourceKey: string): Promise<PushResult> {
  const resource = await getSharedResource(resourceKey);
  if (!resource) return { ok: false, error: "Not shared" };
  if (resource.role === "view") return { ok: false, error: "Read-only for you" };

  try {
    const serverUrl = await serverUrlOrThrow();
    const content = await readLocalContent(resource);
    const result = await syncClient.putShareContent(serverUrl, resource.apiKey, resource.shareId, content, resource.localVersion);
    if (!result.ok) {
      await updateSharedResource(resourceKey, { conflict: true });
      return { ok: false, conflict: true, currentVersion: result.currentVersion };
    }
    await updateSharedResource(resourceKey, { localVersion: result.version, conflict: false });
    return { ok: true, version: result.version };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Fire-and-forget push after a local save — the caller (a storageSet IPC handler, a notes fs.watch hook) doesn't await this; errors just leave the resource's local state ahead of the server until the next push/refresh. */
export function pushResourceInBackground(resourceKey: string): void {
  void pushResource(resourceKey).catch(() => {});
}

export type PullResult = { ok: true } | { ok: false; error: string };

export async function pullResource(resourceKey: string): Promise<PullResult> {
  const resource = await getSharedResource(resourceKey);
  if (!resource) return { ok: false, error: "Not shared" };

  try {
    const serverUrl = await serverUrlOrThrow();
    const { content, version } = await syncClient.getShareContent(serverUrl, resource.apiKey, resource.shareId);
    await writeLocalContent(resource, content);
    await updateSharedResource(resourceKey, { localVersion: version, conflict: false });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function resolveConflict(resourceKey: string, choice: "keep-mine" | "take-theirs"): Promise<PullResult> {
  const resource = await getSharedResource(resourceKey);
  if (!resource) return { ok: false, error: "Not shared" };

  if (choice === "take-theirs") return pullResource(resourceKey);

  try {
    const serverUrl = await serverUrlOrThrow();
    // Learn the server's current version first — pushing with a stale
    // expectedVersion would just 409 again; a forced overwrite has to target
    // whatever the server actually holds right now.
    const remote = await syncClient.getShareContent(serverUrl, resource.apiKey, resource.shareId);
    const content = await readLocalContent(resource);
    const result = await syncClient.putShareContent(serverUrl, resource.apiKey, resource.shareId, content, remote.version);
    if (!result.ok) return { ok: false, error: "Someone pushed again while resolving — try again" };
    await updateSharedResource(resourceKey, { localVersion: result.version, conflict: false });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type ResourceStatus =
  | { shared: false }
  | { shared: true; shareId: string; role: SharedResource["role"]; localVersion: number; conflict: boolean; isOwner: boolean };

export async function getResourceStatus(resourceKey: string): Promise<ResourceStatus> {
  const resource = await getSharedResource(resourceKey);
  if (!resource) return { shared: false };
  const settings = await loadSyncSettings(app.getPath("userData"));
  return {
    shared: true,
    shareId: resource.shareId,
    role: resource.role,
    localVersion: resource.localVersion,
    conflict: !!resource.conflict,
    isOwner: !!settings.ownerApiKey && resource.apiKey === settings.ownerApiKey,
  };
}

/** Owner-side "Compartir…" action — creates the share server-side (seeded with this resource's current local content) and registers it locally as an edit-role SharedResource under the account owner key. */
export async function createShareForResource(
  resourceType: SharedResource["resourceType"],
  resourceKey: string,
  ownerLocalFields: Omit<SharedResource, "resourceKey" | "resourceType" | "shareId" | "role" | "apiKey" | "localVersion" | "conflict">,
): Promise<{ shareId: string }> {
  const userDataDir = app.getPath("userData");
  const serverUrl = await serverUrlOrThrow();
  const ownerApiKey = await ensureOwnerApiKey(userDataDir);
  const settings = await loadSyncSettings(userDataDir);
  const ownerName = settings.ownerName?.trim() || process.env.USER || process.env.USERNAME || "owner";

  const draft: SharedResource = {
    resourceKey,
    resourceType,
    shareId: "",
    role: "edit",
    apiKey: ownerApiKey,
    localVersion: 1,
    ...ownerLocalFields,
  };
  const initialContent = await readLocalContent(draft);

  const { shareId } = await syncClient.createShare(serverUrl, ownerApiKey, { resourceType, resourceKey, initialContent, ownerName });
  await upsertSharedResource({ ...draft, shareId });
  return { shareId };
}

export async function createInviteForResource(
  resourceKey: string,
  role: SharedResource["role"],
  expiresInHours?: number,
): Promise<{ code: string }> {
  const resource = await getSharedResource(resourceKey);
  if (!resource) throw new Error("Not shared");
  const serverUrl = await serverUrlOrThrow();
  return syncClient.createInvite(serverUrl, resource.apiKey, resource.shareId, { role, expiresInHours });
}

/** Teammate side — redeems an invite code, registers the resulting SharedResource locally against `local` (where to write it: a plugin storage key or a notes/ file in one of THIS machine's projects), and seeds local content from the server. */
export async function redeemInviteAndAttach(
  code: string,
  memberName: string,
  local: Omit<SharedResource, "resourceKey" | "resourceType" | "shareId" | "role" | "apiKey" | "localVersion" | "conflict">,
): Promise<SharedResource> {
  const serverUrl = await serverUrlOrThrow();
  const redeemed = await syncClient.redeemInvite(serverUrl, code, memberName);

  // `local` was chosen by the caller before redeeming (the server only
  // reveals resourceType as part of the redeem response itself, there's no
  // "peek an invite" endpoint) — if it picked the wrong shape for what this
  // invite actually is, fail loudly instead of writing a half-formed
  // SharedResource (e.g. resourceType "plugin-storage-key" with only
  // relativePath set, which would crash the next push/pull on a missing
  // pluginId).
  if (redeemed.resourceType === "notes-file" && local.relativePath === undefined) {
    throw new Error("This invite is for a notes file, not a plugin board.");
  }
  if (redeemed.resourceType === "plugin-storage-key" && (local.pluginId === undefined || local.scope === undefined)) {
    throw new Error("This invite is for a plugin board, not a notes file.");
  }

  const resourceKey =
    redeemed.resourceType === "plugin-storage-key"
      ? pluginResourceKey(local.scope!, local.projectId, local.pluginId!, local.storageKey!)
      : notesResourceKey(local.projectId, local.relativePath!);

  const resource: SharedResource = {
    resourceKey,
    resourceType: redeemed.resourceType,
    shareId: redeemed.shareId,
    role: redeemed.role,
    apiKey: redeemed.apiKey,
    localVersion: 1,
    ...local,
  };
  await upsertSharedResource(resource);
  const pulled = await pullResource(resourceKey);
  if (!pulled.ok) throw new Error(`Joined, but initial sync failed: ${pulled.error}`);
  return (await getSharedResource(resourceKey))!;
}

// A plugin's own top-level static files — what the sync-server needs to run
// it in a browser (see sync-server/src/web.ts). Subfolders and binaries are
// skipped; the server only serves flat text files.
const BUNDLE_EXTENSIONS = new Set([".html", ".js", ".css", ".json", ".svg", ".md", ".txt"]);
const MAX_BUNDLE_BYTES = 6 * 1024 * 1024;

async function readPluginBundle(resource: SharedResource): Promise<syncClient.BundleUpload> {
  const project = await getProject(resource.projectId);
  const dir =
    resource.scope === "global"
      ? join(globalPluginsDir(), resource.pluginId!)
      : join(projectPluginsDir(project?.path ?? ""), resource.pluginId!);
  const files: Record<string, string> = {};
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.startsWith(".") || !BUNDLE_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
    const text = await readFile(join(dir, entry.name), "utf8");
    total += Buffer.byteLength(text);
    if (total > MAX_BUNDLE_BYTES) throw new Error("El complemento es demasiado grande para compartirlo por web.");
    files[entry.name] = text;
  }
  if (!files["index.html"]) throw new Error(`El complemento "${resource.pluginId}" no tiene index.html.`);
  let pluginName = resource.pluginId!;
  try {
    pluginName = (JSON.parse(files["manifest.json"] ?? "{}") as { name?: string }).name || pluginName;
  } catch {
    // A broken manifest just means the web page shows the plugin id instead.
  }
  return {
    files,
    project: { id: resource.projectId, name: project?.name ?? "" },
    pluginId: resource.pluginId!,
    pluginName,
    storageKey: resource.storageKey!,
  };
}

async function ownedResourceOrThrow(resourceKey: string): Promise<{ resource: SharedResource; serverUrl: string }> {
  const resource = await getSharedResource(resourceKey);
  if (!resource) throw new Error("Not shared");
  const settings = await loadSyncSettings(app.getPath("userData"));
  if (!settings.ownerApiKey || resource.apiKey !== settings.ownerApiKey) throw new Error("Solo quien compartió este recurso puede gestionar sus accesos.");
  return { resource, serverUrl: await serverUrlOrThrow() };
}

/** Uploads (or re-uploads) a shared plugin's own code to the sync-server so web visitors run the current version. No-op for notes files. */
export async function refreshWebBundle(resourceKey: string): Promise<void> {
  const { resource, serverUrl } = await ownedResourceOrThrow(resourceKey);
  if (resource.resourceType !== "plugin-storage-key") return;
  await syncClient.putBundle(serverUrl, resource.apiKey, resource.shareId, await readPluginBundle(resource));
}

/** Owner-side browser link for someone without the desktop app — they open it and must type `email` to get in (see sync-server's requireAccess). */
export async function createWebLinkForResource(
  resourceKey: string,
  email: string,
  role: SharedResource["role"],
): Promise<{ url: string; keyHash: string }> {
  const { resource, serverUrl } = await ownedResourceOrThrow(resourceKey);
  // Always ship the plugin's current code with a new link, so the page it
  // opens matches what the owner has installed right now.
  if (resource.resourceType === "plugin-storage-key") {
    await syncClient.putBundle(serverUrl, resource.apiKey, resource.shareId, await readPluginBundle(resource));
  }
  return syncClient.createWebLink(serverUrl, resource.apiKey, resource.shareId, { email, role });
}

export async function listMembersForResource(resourceKey: string): Promise<syncClient.ShareMember[]> {
  const { resource, serverUrl } = await ownedResourceOrThrow(resourceKey);
  return syncClient.listMembers(serverUrl, resource.apiKey, resource.shareId);
}

export async function revokeMemberForResource(resourceKey: string, memberKeyHash: string): Promise<void> {
  const { resource, serverUrl } = await ownedResourceOrThrow(resourceKey);
  await syncClient.revokeMember(serverUrl, resource.apiKey, resource.shareId, memberKeyHash);
}

export async function listMyShares(): Promise<Awaited<ReturnType<typeof syncClient.listMyShares>>> {
  const userDataDir = app.getPath("userData");
  const serverUrl = await serverUrlOrThrow();
  const ownerApiKey = await ensureOwnerApiKey(userDataDir);
  return syncClient.listMyShares(serverUrl, ownerApiKey);
}
