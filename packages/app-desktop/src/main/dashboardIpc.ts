// IPC behind the Dashboard tab and the Estudio's widget preview. Only the app's
// own renderer reaches these (a widget iframe has no preload): main stays the
// authority on which hosts an instance may reach and holds its secrets.
import { join } from "node:path";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import {
  canStoreSecrets,
  readDashboard,
  readSecret,
  sanitizeInstance,
  savedSecretFields,
  saveSecrets,
  writeDashboard,
  type DashboardLayout,
  type StoredSecret,
  type WidgetInstance,
} from "./dashboardStore.js";
import { NetError } from "./netGuard.js";
import { globalPluginsDir, readManifest, type PluginManifest } from "./plugins.js";
import { createWidgetCache, type CachedResponse, type WidgetCache } from "./widgetNet.js";
import { clampRefresh, netDomains } from "./widgetSpec.js";

/**
 * Unsaved settings being previewed (configure dialog, Estudio). Memory only:
 * its secrets are never written unless the person saves.
 */
export type WidgetDraft = {
  instance: WidgetInstance;
  /** Secrets typed but not saved. */
  secrets: Record<string, string>;
  /** The saved instance whose stored secrets apply where nothing new was typed. */
  secretsFrom?: string;
};

export type WidgetFetchResult = ({ ok: true } & { response: CachedResponse }) | { ok: false; error: string };

const drafts = new Map<string, WidgetDraft>();
let cache: WidgetCache | undefined;

function widgetCache(): WidgetCache {
  return (cache ??= createWidgetCache(join(app.getPath("userData"), "dashboard-cache.json")));
}

async function manifestOf(pluginKey: string): Promise<PluginManifest> {
  const id = pluginKey.slice("global:".length);
  if (!pluginKey.startsWith("global:") || !/^[a-z0-9][a-z0-9-_]{0,63}$/.test(id)) throw new Error("complemento inválido");
  const manifest = await readManifest(join(globalPluginsDir(), id));
  if (!manifest.widget) throw new Error("este complemento no es un widget");
  return manifest;
}

async function widgetFetch(instanceId: string, url: string, auth: string | undefined): Promise<CachedResponse> {
  const draft = drafts.get(instanceId);
  const instance = draft?.instance ?? (await readDashboard()).instances.find((i) => i.instanceId === instanceId);
  if (!instance) throw new NetError("not-granted", "instancia desconocida");
  const manifest = await manifestOf(instance.pluginKey);
  const allowed = netDomains(manifest.permissions).filter((d) => instance.grantedDomains.includes(d));

  let secret;
  if (auth !== undefined) {
    const field = manifest.widget!.fields.find((f) => f.key === auth && f.type === "secret");
    if (!field?.domain || !field.header) throw new NetError("no-secret", `"${auth}" no es un campo secreto del widget`);
    const typed = draft?.secrets[auth];
    const stored: StoredSecret | undefined = typed
      ? { value: typed, domain: field.domain }
      : await readSecret(draft?.secretsFrom ?? instanceId, auth);
    // A key typed for one host is not sent to another one an update asks for.
    if (!stored || stored.domain !== field.domain) throw new NetError("no-secret", `falta ${field.title}`);
    secret = { header: field.header, prefix: field.prefix, value: stored.value, domain: stored.domain };
  }
  const interval = clampRefresh(instance.refreshSeconds, manifest.widget!);
  return widgetCache().fetch(instanceId, interval, { url, allowed, secret });
}

/** The saved secrets of `values`, each bound to the host its manifest field declares. */
async function bindSecrets(pluginKey: string, values: Record<string, string>): Promise<Record<string, StoredSecret>> {
  const manifest = await manifestOf(pluginKey);
  const out: Record<string, StoredSecret> = {};
  for (const field of manifest.widget!.fields) {
    const value = values[field.key];
    if (field.type === "secret" && field.domain && value) out[field.key] = { value, domain: field.domain };
  }
  return out;
}

function broadcast(layout: DashboardLayout): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("dashboard:changed", layout);
  }
}

async function save(layout: DashboardLayout): Promise<DashboardLayout> {
  const saved = await writeDashboard(layout);
  const alive = new Set(saved.instances.map((i) => i.instanceId));
  await widgetCache().retain((id) => alive.has(id) || id.startsWith("preview:") || drafts.has(id));
  broadcast(saved);
  return saved;
}

export function installDashboardIpc(): void {
  ipcMain.handle("dashboard:get", () => readDashboard());

  // Reorder, resize, remove.
  ipcMain.handle("dashboard:save", (_event, layout: DashboardLayout) => save(layout));

  /** Add or reconfigure one instance, with whatever secrets were typed. */
  ipcMain.handle(
    "dashboard:commit",
    async (_event, instance: WidgetInstance, secrets: Record<string, string>, draftId?: string) => {
      const clean = sanitizeInstance(instance);
      if (!clean) throw new Error("instancia inválida");
      await saveSecrets(clean.instanceId, await bindSecrets(clean.pluginKey, secrets));
      if (draftId) {
        await widgetCache().adopt(draftId, clean.instanceId);
        drafts.delete(draftId);
      }
      const { instances } = await readDashboard();
      const index = instances.findIndex((i) => i.instanceId === clean.instanceId);
      if (index >= 0) instances[index] = clean;
      else instances.push(clean);
      return save({ instances });
    },
  );

  ipcMain.handle("dashboard:setDraft", (_event, id: string, draft: WidgetDraft) => {
    const instance = sanitizeInstance(draft.instance);
    if (!instance || instance.instanceId !== id) throw new Error("borrador inválido");
    drafts.set(id, { instance, secrets: { ...draft.secrets }, secretsFrom: draft.secretsFrom });
  });

  ipcMain.handle("dashboard:dropDraft", (_event, id: string) => {
    drafts.delete(id);
  });

  /** Which secret fields have a saved value (and for which host), never the values. */
  ipcMain.handle("dashboard:secretStatus", async (_event, instanceId: string) => ({
    saved: await savedSecretFields(instanceId),
    canStore: canStoreSecrets(),
  }));

  ipcMain.handle("dashboard:fetch", async (_event, instanceId: string, url: string, auth?: string): Promise<WidgetFetchResult> => {
    try {
      return { ok: true, response: await widgetFetch(instanceId, url, auth) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("dashboard:invalidate", (_event, instanceId: string) => widgetCache().invalidate(instanceId));

  ipcMain.handle("dashboard:openLink", async (_event, url: string) => {
    if (new URL(url).protocol !== "https:") throw new Error("solo enlaces https");
    await shell.openExternal(url);
  });

}
