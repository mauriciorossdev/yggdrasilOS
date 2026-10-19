import { randomBytes } from "node:crypto";
import { readSettingsFile, updateSettingsFile } from "./settingsFile.js";

export type SyncSettings = {
  /** Base URL of the deployed @yggdrasil/sync-server (e.g. a Railway domain), no trailing slash. */
  serverUrl?: string;
  /** This machine's own account-level credential — created locally the first time it's needed (see ensureOwnerApiKey), never entered by hand. Reused across every share this user creates. */
  ownerApiKey?: string;
  /** Shown to teammates as the share's creator — defaults to the OS username if never set. */
  ownerName?: string;
};

export function defaultSyncSettings(): SyncSettings {
  return {};
}

/** desktop-settings.json also holds sync's settings (nested under "sync") — see settingsFile.ts's shared write queue. */
export async function loadSyncSettings(userDataDir: string): Promise<SyncSettings> {
  const defaults = defaultSyncSettings();
  const raw = await readSettingsFile(userDataDir);
  return { ...defaults, ...((raw as { sync?: Partial<SyncSettings> }).sync ?? {}) };
}

export async function saveSyncSettings(userDataDir: string, settings: SyncSettings): Promise<void> {
  await updateSettingsFile(userDataDir, (existing) => ({ ...existing, sync: settings }));
}

/**
 * Mints and persists this machine's owner key on first use — there's no
 * separate account-registration step (see sync-server's README): whichever
 * key first shows up as the Authorization bearer on POST /v1/shares
 * implicitly becomes that share's owner, so generating one locally the
 * moment it's needed is sufficient. Reused for every share this user creates
 * afterwards.
 */
export async function ensureOwnerApiKey(userDataDir: string): Promise<string> {
  const settings = await loadSyncSettings(userDataDir);
  if (settings.ownerApiKey) return settings.ownerApiKey;
  const ownerApiKey = `ygs_${randomBytes(24).toString("base64url")}`;
  await saveSyncSettings(userDataDir, { ...settings, ownerApiKey });
  return ownerApiKey;
}
