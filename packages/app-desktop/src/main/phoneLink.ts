import { hostname, networkInterfaces } from "node:os";
import { app, ipcMain } from "electron";
import QRCode from "qrcode";
import { listOpenGateways } from "./openGateways.js";
import { listProjects } from "./projects.js";
import { readSettingsFile, updateSettingsFile } from "./settingsFile.js";
import {
  HubPublisher,
  friendlyHostName,
  hubQrPayload,
  localGatewayRequiresKey,
  isPublishable,
  newDesktopId,
  newGatewayKey,
  pickAddresses,
  type OpenProject,
  type PhoneLinkSettings,
  type PublishStatus,
} from "./phoneLinkCore.js";
import { TunnelClient, type TunnelState } from "./tunnelCore.js";

/** What the Settings → Teléfono section shows (never the hub key itself). */
export type PhoneLinkInfo = {
  hubUrl: string;
  hasHubKey: boolean;
  publish: boolean;
  desktopName: string;
  addresses: { lan?: string; tailscale?: string };
  status: PublishStatus;
  tunnel: { state: TunnelState; lastError?: string };
  needsReopen: string[];
};

const userData = () => app.getPath("userData");

export async function loadPhoneLinkSettings(): Promise<PhoneLinkSettings> {
  const raw = await readSettingsFile(userData());
  return { ...((raw as { phoneLink?: PhoneLinkSettings }).phoneLink ?? {}) };
}

async function savePhoneLinkSettings(settings: PhoneLinkSettings): Promise<void> {
  await updateSettingsFile(userData(), (existing) => ({ ...existing, phoneLink: settings }));
}

/** desktopId + gatewayKey are minted once, locally, the first time publishing is turned on. */
async function ensureIdentity(settings: PhoneLinkSettings): Promise<PhoneLinkSettings> {
  if (settings.desktopId && settings.gatewayKey) return settings;
  const next = { ...settings, desktopId: settings.desktopId ?? newDesktopId(), gatewayKey: settings.gatewayKey ?? newGatewayKey() };
  await savePhoneLinkSettings(next);
  return next;
}

/**
 * Auth for a project gateway about to be launched: while publishing is on, the
 * gateway requires this desktop's key from anything that isn't this machine
 * (its own window connects over 127.0.0.1, trusted via YGGDRASIL_TRUST_LOOPBACK).
 */
export async function gatewayAuthForNewProject(): Promise<{ apiKey: string } | undefined> {
  const settings = await loadPhoneLinkSettings();
  if (!settings.publish) return undefined;
  const withIdentity = await ensureIdentity(settings);
  return { apiKey: withIdentity.gatewayKey! };
}

/** Open projects whose gateway runs without the key (opened before publishing). */
let needsReopen: string[] = [];
let keyedPorts = new Set<number>();

async function openProjectsSnapshot(): Promise<OpenProject[]> {
  const [open, projects] = await Promise.all([listOpenGateways(), listProjects()]);
  const all = Object.entries(open).map(([id, { port }]) => ({
    id,
    port,
    name: projects.find((p) => p.id === id)?.name ?? "Proyecto",
  }));
  const keyed = await Promise.all(all.map((p) => localGatewayRequiresKey(p.port)));
  needsReopen = all.filter((_, i) => keyed[i] === false).map((p) => p.name);
  const published = all.filter((_, i) => keyed[i] === true);
  keyedPorts = new Set(published.map((p) => p.port));
  return published;
}

const publisher = new HubPublisher({
  getSettings: loadPhoneLinkSettings,
  getProjects: openProjectsSnapshot,
  getHostName: () => friendlyHostName(hostname()),
  getAddresses: () => pickAddresses(networkInterfaces()),
});

// Phase B: keeps an outbound socket to Railway so the phone reaches this
// desktop from any network (no VPN) — only while publishing is on.
const tunnel = new TunnelClient({
  getSettings: loadPhoneLinkSettings,
  getProjectPort: async (projectId) => {
    const port = (await listOpenGateways())[projectId]?.port;
    return port !== undefined && keyedPorts.has(port) ? port : undefined;
  },
});

export function startPhoneLink(): void {
  publisher.start();
  void tunnel.start();
}

/** A project opened or closed: tell the hub now instead of at the next heartbeat. */
export function notifyPhoneLinkChanged(): void {
  void publisher.publishNow();
}

export async function stopPhoneLink(): Promise<void> {
  publisher.stop();
  tunnel.stop();
  await publisher.goOffline();
}

async function info(): Promise<PhoneLinkInfo> {
  const s = await loadPhoneLinkSettings();
  return {
    hubUrl: s.hubUrl ?? "",
    hasHubKey: !!s.hubKey,
    publish: !!s.publish,
    desktopName: friendlyHostName(hostname()),
    addresses: pickAddresses(networkInterfaces()),
    status: isPublishable(s) ? publisher.status : { state: "disabled" },
    tunnel: { state: tunnel.state, ...(tunnel.lastError ? { lastError: tunnel.lastError } : {}) },
    needsReopen: isPublishable(s) ? needsReopen : [],
  };
}

export function registerPhoneLinkIpc(): void {
  ipcMain.handle("phoneLink:get", () => info());

  ipcMain.handle("phoneLink:save", async (_event, input: { hubUrl?: string; hubKey?: string; publish?: boolean }) => {
    let next: PhoneLinkSettings = { ...(await loadPhoneLinkSettings()) };
    if (typeof input.hubUrl === "string") next.hubUrl = input.hubUrl.trim();
    // An empty key field means "keep the saved one" — the UI never receives it back.
    if (typeof input.hubKey === "string" && input.hubKey.trim()) next.hubKey = input.hubKey.trim();
    if (typeof input.publish === "boolean") next.publish = input.publish;
    await savePhoneLinkSettings(next);
    if (next.publish) next = await ensureIdentity(next);
    await publisher.publishNow();
    await tunnel.start(); // new URL/key, or publishing switched on/off
    return info();
  });

  ipcMain.handle("phoneLink:publishNow", async () => {
    await publisher.publishNow();
    return info();
  });

  // The hub key travels inside the QR: only generated on demand, never stored as an image.
  ipcMain.handle("phoneLink:qr", async () => {
    const s = await loadPhoneLinkSettings();
    if (!s.hubUrl || !s.hubKey) throw new Error("Guarda primero la URL y la clave de Railway.");
    return QRCode.toDataURL(hubQrPayload(s.hubUrl, s.hubKey), { margin: 1, width: 320 });
  });
}
