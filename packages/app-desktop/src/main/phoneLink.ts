import { hostname, networkInterfaces } from "node:os";
import { app, ipcMain } from "electron";
import QRCode from "qrcode";
import { listOpenGateways } from "./openGateways.js";
import { listProjects } from "./projects.js";
import { readSettingsFile, updateSettingsFile } from "./settingsFile.js";
import {
  HubPublisher,
  checkHubUrl,
  friendlyHostName,
  gatewaysNeedKey,
  hubQrPayload,
  localGatewayRequiresKey,
  localLinkActive,
  localLinkUrl,
  localQrPayload,
  startLocalLinkServer,
  type LocalLinkServer,
  isPublishable,
  newDesktopId,
  newGatewayKey,
  newHubKey,
  pickAddresses,
  savedKeyWouldMove,
  testHubConnection,
  type HubUrlCheck,
  type OpenProject,
  type PhoneLinkSettings,
  type PublishStatus,
} from "./phoneLinkCore.js";
import { TunnelClient, type TunnelState } from "./tunnelCore.js";

/** What the Settings → Teléfono section shows (never the hub key itself). */
export type PhoneLinkInfo = {
  hubUrl: string;
  hubUrlCheck: HubUrlCheck;
  hasHubKey: boolean;
  publish: boolean;
  desktopName: string;
  addresses: { lan?: string; tailscale?: string };
  status: PublishStatus;
  tunnel: { state: TunnelState; lastError?: string };
  needsReopen: string[];
  /** Same-network link without a link server (only usable while no hub URL is set). */
  localLink: { enabled: boolean; active: boolean; url?: string; error?: string };
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
  if (!gatewaysNeedKey(settings)) return undefined;
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

// Phase B: keeps an outbound socket to the link server so the phone reaches this
// desktop from any network (no VPN) — only while publishing is on.
const tunnel = new TunnelClient({
  getSettings: loadPhoneLinkSettings,
  getProjectPort: async (projectId) => {
    const port = (await listOpenGateways())[projectId]?.port;
    return port !== undefined && keyedPorts.has(port) ? port : undefined;
  },
});

// Local link: this desktop answers the phone's directory call itself, on the
// same network, when there's no link server (phoneLinkCore.ts, "Local link").
let localServer: LocalLinkServer | undefined;
let localKey: string | undefined;
let localError: string | undefined;

async function localDesktopEntry(): Promise<Record<string, unknown>> {
  const s = await loadPhoneLinkSettings();
  return {
    desktopId: s.desktopId,
    name: friendlyHostName(hostname()),
    online: true,
    lastSeen: Date.now(),
    projects: await openProjectsSnapshot(),
    endpoints: pickAddresses(networkInterfaces()),
    gatewayKey: s.gatewayKey,
    tunnel: false,
  };
}

/** Starts or stops the local-link listener to match the saved settings. Calls run one at a time. */
let localSync: Promise<void> = Promise.resolve();
function syncLocalLink(): Promise<void> {
  localSync = localSync.then(syncLocalLinkNow, syncLocalLinkNow);
  return localSync;
}

async function syncLocalLinkNow(): Promise<void> {
  let s = await loadPhoneLinkSettings();
  if (!localLinkActive(s)) {
    localKey = undefined;
    localError = undefined;
    const server = localServer;
    localServer = undefined;
    await server?.close();
    return;
  }
  s = await ensureIdentity(s);
  localKey = s.gatewayKey;
  if (localServer) return;
  try {
    localServer = await startLocalLinkServer(
      { getKey: () => localKey, getDesktop: localDesktopEntry },
      { preferredPort: s.localLinkPort, onError: (err) => console.warn("[phoneLink] local link:", err.message) },
    );
    localError = undefined;
    // First start, or the saved port was taken: keep the one in use (the QR shows it).
    if (localServer.port !== s.localLinkPort) {
      await savePhoneLinkSettings({ ...(await loadPhoneLinkSettings()), localLinkPort: localServer.port });
    }
  } catch (err) {
    localError = err instanceof Error ? err.message : String(err);
  }
}

export function startPhoneLink(): void {
  publisher.start();
  void tunnel.start();
  void syncLocalLink();
}

/** A project opened or closed: tell the hub now instead of at the next heartbeat. */
export function notifyPhoneLinkChanged(): void {
  void publisher.publishNow();
}

export async function stopPhoneLink(): Promise<void> {
  publisher.stop();
  tunnel.stop();
  const server = localServer;
  localServer = undefined;
  await server?.close();
  await publisher.goOffline();
}

async function info(): Promise<PhoneLinkInfo> {
  const s = await loadPhoneLinkSettings();
  const addresses = pickAddresses(networkInterfaces());
  const localUrl = localServer ? localLinkUrl(addresses, localServer.port) : undefined;
  if (localLinkActive(s)) await openProjectsSnapshot(); // fresh needsReopen without a hub publisher
  return {
    hubUrl: s.hubUrl ?? "",
    hubUrlCheck: checkHubUrl(s.hubUrl ?? ""),
    hasHubKey: !!s.hubKey,
    publish: !!s.publish,
    desktopName: friendlyHostName(hostname()),
    addresses,
    status: isPublishable(s) ? publisher.status : { state: "disabled" },
    tunnel: { state: tunnel.state, ...(tunnel.lastError ? { lastError: tunnel.lastError } : {}) },
    needsReopen: isPublishable(s) || localLinkActive(s) ? needsReopen : [],
    localLink: {
      enabled: !!s.localLink,
      active: localLinkActive(s),
      ...(localUrl ? { url: localUrl } : {}),
      ...(localError ? { error: localError } : {}),
    },
  };
}

export function registerPhoneLinkIpc(): void {
  ipcMain.handle("phoneLink:get", () => info());

  ipcMain.handle("phoneLink:save", async (_event, input: { hubUrl?: string; hubKey?: string; publish?: boolean; localLink?: boolean }) => {
    let next: PhoneLinkSettings = { ...(await loadPhoneLinkSettings()) };
    if (savedKeyWouldMove(next, input)) throw new Error("Pega la clave de este servidor: la guardada no se envía a otra URL.");
    if (typeof input.hubUrl === "string") {
      const check = checkHubUrl(input.hubUrl);
      if (check === "invalid" || check === "insecure-public") throw new Error("Esa URL del servidor de enlace no se puede usar sin cifrar.");
      next.hubUrl = input.hubUrl.trim();
    }
    // An empty key field means "keep the saved one" — the UI never receives it back.
    if (typeof input.hubKey === "string" && input.hubKey.trim()) next.hubKey = input.hubKey.trim();
    if (typeof input.publish === "boolean") next.publish = input.publish;
    if (typeof input.localLink === "boolean") next.localLink = input.localLink;
    await savePhoneLinkSettings(next);
    if (next.publish) next = await ensureIdentity(next);
    await publisher.publishNow();
    await tunnel.start(); // new URL/key, or publishing switched on/off
    await syncLocalLink(); // local link switched on/off, or a hub URL now replaces it
    return info();
  });

  ipcMain.handle("phoneLink:checkUrl", (_event, hubUrl: unknown) => checkHubUrl(String(hubUrl ?? "")));

  ipcMain.handle("phoneLink:generateKey", () => newHubKey());

  ipcMain.handle("phoneLink:test", async (_event, input: { hubUrl?: string; hubKey?: string }) => {
    const s = await loadPhoneLinkSettings();
    const hubUrl = String(input?.hubUrl ?? "").trim();
    // The saved key only ever goes to the URL it was saved with.
    const savedKey = hubUrl === s.hubUrl ? (s.hubKey ?? "") : "";
    return testHubConnection(hubUrl, String(input?.hubKey ?? "").trim() || savedKey);
  });

  ipcMain.handle("phoneLink:publishNow", async () => {
    await publisher.publishNow();
    return info();
  });

  // Local link QR: this desktop's address + its gateway key, for the same network only.
  ipcMain.handle("phoneLink:localQr", async () => {
    const s = await loadPhoneLinkSettings();
    if (!localLinkActive(s) || !localServer || !s.gatewayKey) throw new Error("Activa primero la conexión en esta red.");
    const url = localLinkUrl(pickAddresses(networkInterfaces()), localServer.port);
    if (!url) throw new Error("Este equipo no tiene una dirección de red local ni de Tailscale.");
    return QRCode.toDataURL(localQrPayload(url, s.gatewayKey), { margin: 1, width: 320 });
  });

  // The hub key travels inside the QR: only generated on demand, never stored as an image.
  ipcMain.handle("phoneLink:qr", async () => {
    const s = await loadPhoneLinkSettings();
    if (!s.hubUrl || !s.hubKey) throw new Error("Guarda primero la URL y la clave del servidor de enlace.");
    if (checkHubUrl(s.hubUrl) === "insecure-public") throw new Error("Esa URL del servidor de enlace no se puede usar sin cifrar.");
    return QRCode.toDataURL(hubQrPayload(s.hubUrl, s.hubKey), { margin: 1, width: 320 });
  });
}
