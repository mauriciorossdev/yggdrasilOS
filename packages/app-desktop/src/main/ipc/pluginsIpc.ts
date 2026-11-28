// IPC for complementos: listing, files, publishing, storage and tool calls.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { BrowserWindow, ipcMain, shell } from "electron";
import { pluginStorageDelete, pluginStorageGet, pluginStorageKeys, pluginStorageSet } from "../pluginStorage.js";
import { indexPluginStorageOnWrite } from "../pluginStorageIndex.js";
import { type PluginTabsLayout, readPluginTabs, writePluginTabs } from "../pluginTabs.js";
import {
  type PluginManifestPatch,
  type PluginScope,
  type PluginStatus,
  type ScaffoldPluginSpec,
  deletePlugin,
  lintPluginPermissions,
  listPluginFiles,
  scaffoldPlugin,
  scanPlugins,
  setPluginStatus,
  updatePluginManifest,
} from "../plugins.js";
import { getProject } from "../projects.js";
import { resourceKeyFor } from "../sharedResources.js";
import { pushResourceInBackground } from "../syncEngine.js";

type Deps = {
  /** Tool calls waiting for the plugin's answer, shared with whoever started them. */
  pendingPluginToolCalls: Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>;
};

export function registerPluginsIpc({ pendingPluginToolCalls }: Deps): void {
  ipcMain.handle("plugins:list", async (_event, projectId: string) => {
    const project = await getProject(projectId);
    if (!project) return [];
    return scanPlugins(projectId, project.path);
  });
  // Manual "Recargar" — rescans immediately (a plugins:changed watcher event
  // already does this on its own; this is for when the user doesn't want to
  // wait out the debounce, or the fs.watch backend missed something).
  ipcMain.handle("plugins:reload", async (_event, projectId: string) => {
    const project = await getProject(projectId);
    const records = project ? await scanPlugins(projectId, project.path) : [];
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send("plugins:changed", { scope: "all" });
    }
    return records;
  });
  ipcMain.handle("plugins:storageGet", (_event, projectId: string, scope: PluginScope, id: string, key: string) =>
    pluginStorageGet(scope, id, projectId, key),
  );
  ipcMain.handle(
    "plugins:storageSet",
    async (_event, projectId: string, scope: PluginScope, id: string, key: string, value: unknown) => {
      await pluginStorageSet(scope, id, projectId, key, value);
      // A no-op if this key isn't shared (pushResource just returns "Not
      // shared" and pushResourceInBackground swallows it) — see
      // syncEngine.ts. Fire-and-forget so a save never waits on the network.
      pushResourceInBackground(resourceKeyFor({ resourceType: "plugin-storage-key", projectId, scope, pluginId: id, storageKey: key }));
      // Same fire-and-forget posture — keeps plugin_data_search fresh
      // without making a plugin's own save wait on a sqlite write.
      const project = await getProject(projectId);
      if (project) indexPluginStorageOnWrite(project.path, scope, id, key, value);
    },
  );
  ipcMain.handle(
    "plugins:storageDelete",
    async (_event, projectId: string, scope: PluginScope, id: string, key: string) => {
      await pluginStorageDelete(scope, id, projectId, key);
      const project = await getProject(projectId);
      if (project) indexPluginStorageOnWrite(project.path, scope, id, key, undefined);
    },
  );
  ipcMain.handle("plugins:storageKeys", (_event, projectId: string, scope: PluginScope, id: string) =>
    pluginStorageKeys(scope, id, projectId),
  );
  // ygg.fs.write/mkdir (a "fs:write"-permission plugin) — deliberately its
  // own IPC instead of proxying through the gateway's fs.write/fs.mkdir RPC:
  // those always pop the ApprovalBar, even from this app's own loopback
  // connection (see ChatView.tsx's floating approval-bar-overlay comment),
  // which would mean an approval prompt on every single plugin save. Same
  // resolve/relative root-confinement guard as files:openExternal above.
  // The gateway's own fs.watch still sees the write and emits fs.changed
  // (FileTree, DocumentsView, and a "fs" plugin's own listener all pick it
  // up the normal way) — this only bypasses the RPC's approval gate, not the
  // workspace root confinement or the change notification.
  ipcMain.handle("plugins:fsWrite", async (_event, projectId: string, relativePath: string, content: string) => {
    const project = await getProject(projectId);
    if (!project) throw new Error("Unknown project");
    const resolvedRoot = resolve(project.path);
    const target = resolve(resolvedRoot, relativePath);
    const rel = relative(resolvedRoot, target);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("relativePath escapes the project root");
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  });
  ipcMain.handle("plugins:fsMkdir", async (_event, projectId: string, relativePath: string) => {
    const project = await getProject(projectId);
    if (!project) throw new Error("Unknown project");
    const resolvedRoot = resolve(project.path);
    const target = resolve(resolvedRoot, relativePath);
    const rel = relative(resolvedRoot, target);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("relativePath escapes the project root");
    await mkdir(target, { recursive: true });
  });
  ipcMain.handle("plugins:getLayout", (_event, projectId: string) => readPluginTabs(projectId));
  ipcMain.handle("plugins:saveLayout", (_event, projectId: string, layout: PluginTabsLayout) =>
    writePluginTabs(projectId, layout),
  );
  // PluginsSection's "Mostrar carpeta" — `dir` always comes from a
  // PluginRecord this same process handed the renderer via plugins:list, so
  // there's no untrusted-path concern here (unlike files:openExternal above,
  // whose relativePath is confined against the project root because it's
  // reachable from arbitrary chat/tool input).
  ipcMain.handle("plugins:reveal", (_event, dir: string) => {
    shell.showItemInFolder(dir);
  });
  // Reply half of the callTool request/response pair built in openProject()
  // above — PluginToolRuntime.tsx (renderer) calls this once it has (or
  // fails to get) a result from the plugin's own headless iframe.
  ipcMain.handle("plugins:toolCallResult", (_event, callId: string, ok: boolean, resultOrError: unknown) => {
    const pending = pendingPluginToolCalls.get(callId);
    if (!pending) return; // late or duplicate reply — nothing waiting on it anymore
    pendingPluginToolCalls.delete(callId);
    if (ok) pending.resolve(resultOrError);
    else pending.reject(new Error(typeof resultOrError === "string" ? resultOrError : "tool call failed"));
  });
  // Studio's own scaffold entry point — direct, no HTTP/MCP hop (unlike the
  // scaffold_plugin MCP tool, only reachable from a claude CLI pane). status
  // defaults to "draft" HERE, not inside scaffoldPlugin itself, so the
  // existing MCP tool's own default (undefined/published) stays untouched.
  ipcMain.handle("plugins:scaffold", async (_event, projectId: string, spec: ScaffoldPluginSpec) => {
    const project = await getProject(projectId);
    if (!project) throw new Error("Unknown project");
    const record = await scaffoldPlugin({ ...spec, status: spec.status ?? "draft" }, projectId, project.path);
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send("plugins:changed", { scope: "all" });
    }
    return record;
  });
  ipcMain.handle(
    "plugins:setStatus",
    async (_event, projectId: string, scope: PluginScope, id: string, status: PluginStatus) => {
      const project = await getProject(projectId);
      if (!project) throw new Error("Unknown project");
      const record = await setPluginStatus(scope, id, projectId, project.path, status);
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send("plugins:changed", { scope: "all" });
      }
      return record;
    },
  );
  ipcMain.handle(
    "plugins:updateManifest",
    async (_event, projectId: string, scope: PluginScope, id: string, patch: PluginManifestPatch) => {
      const project = await getProject(projectId);
      if (!project) throw new Error("Unknown project");
      const record = await updatePluginManifest(scope, id, projectId, project.path, patch);
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send("plugins:changed", { scope: "all" });
      }
      return record;
    },
  );
  ipcMain.handle("plugins:listFiles", async (_event, projectId: string, scope: PluginScope, id: string) => {
    const project = await getProject(projectId);
    if (!project) throw new Error("Unknown project");
    return listPluginFiles(scope, id, project.path);
  });
  ipcMain.handle("plugins:lintPermissions", async (_event, projectId: string, scope: PluginScope, id: string) => {
    const project = await getProject(projectId);
    if (!project) throw new Error("Unknown project");
    return lintPluginPermissions(scope, id, project.path);
  });
  ipcMain.handle("plugins:delete", async (_event, projectId: string, scope: PluginScope, id: string) => {
    const project = await getProject(projectId);
    if (!project) throw new Error("Unknown project");
    await deletePlugin(scope, id, project.path);
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send("plugins:changed", { scope: "all" });
    }
  });
}
