// IPC for sync between computers.
import { app, ipcMain } from "electron";
import { type ResourceRef, resourceKeyFor } from "../sharedResources.js";
import {
  createInviteForResource,
  createShareForResource,
  createWebLinkForResource,
  getResourceStatus,
  listMembersForResource,
  listMyShares as listMySyncShares,
  pullResource,
  pushResource,
  redeemInviteAndAttach,
  refreshWebBundle,
  resolveConflict as resolveSyncConflict,
  revokeMemberForResource,
} from "../syncEngine.js";
import { type SyncSettings, loadSyncSettings, saveSyncSettings } from "../syncSettings.js";

export function registerSyncIpc(): void {
  ipcMain.handle("sync:getSettings", async (): Promise<SyncSettings> => loadSyncSettings(app.getPath("userData")));
  ipcMain.handle("sync:saveSettings", async (_event, settings: SyncSettings) => {
    await saveSyncSettings(app.getPath("userData"), settings);
  });
  ipcMain.handle("sync:createShare", (_event, ref: ResourceRef) => {
    const { resourceType, ...local } = ref;
    return createShareForResource(resourceType, resourceKeyFor(ref), local);
  });
  ipcMain.handle(
    "sync:createInvite",
    (_event, ref: ResourceRef, role: "edit" | "view", expiresInHours?: number) =>
      createInviteForResource(resourceKeyFor(ref), role, expiresInHours),
  );
  ipcMain.handle("sync:redeemInvite", (_event, code: string, memberName: string, ref: ResourceRef) => {
    const { resourceType: _resourceType, ...local } = ref;
    return redeemInviteAndAttach(code, memberName, local);
  });
  ipcMain.handle("sync:listMyShares", () => listMySyncShares());
  ipcMain.handle("sync:getResourceStatus", (_event, ref: ResourceRef) => getResourceStatus(resourceKeyFor(ref)));
  ipcMain.handle("sync:push", (_event, ref: ResourceRef) => pushResource(resourceKeyFor(ref)));
  ipcMain.handle("sync:pull", (_event, ref: ResourceRef) => pullResource(resourceKeyFor(ref)));
  ipcMain.handle(
    "sync:resolveConflict",
    (_event, ref: ResourceRef, choice: "keep-mine" | "take-theirs") => resolveSyncConflict(resourceKeyFor(ref), choice),
  );
  ipcMain.handle("sync:createWebLink", (_event, ref: ResourceRef, email: string, role: "edit" | "view") =>
    createWebLinkForResource(resourceKeyFor(ref), email, role),
  );
  ipcMain.handle("sync:listMembers", (_event, ref: ResourceRef) => listMembersForResource(resourceKeyFor(ref)));
  ipcMain.handle("sync:revokeMember", (_event, ref: ResourceRef, memberKeyHash: string) =>
    revokeMemberForResource(resourceKeyFor(ref), memberKeyHash),
  );
  ipcMain.handle("sync:refreshWebBundle", (_event, ref: ResourceRef) => refreshWebBundle(resourceKeyFor(ref)));
}
