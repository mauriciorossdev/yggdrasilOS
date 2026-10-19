import { readJsonFile, writeJsonFile } from "./jsonFile.js";

/** A project window open on a desktop, with the port its gateway got this launch. */
export type DesktopProject = { id: string; name: string; port: number };

/** Where the desktop can be reached (bare hosts/IPs; the port is per project). */
export type DesktopEndpoints = { lan?: string; tailscale?: string };

export type DesktopRecord = {
  desktopId: string;
  name: string;
  projects: DesktopProject[];
  endpoints: DesktopEndpoints;
  /** The desktop gateway's own API key, handed to the phone so it can connect. */
  gatewayKey?: string;
  registeredAt: number;
  lastSeen: number;
};

export type DesktopView = DesktopRecord & { online: boolean };

/** A desktop that hasn't sent its heartbeat (every 60 s) for this long is shown as offline. */
export const ONLINE_WINDOW_MS = 90_000;
/** Records nobody has refreshed for this long are dropped. */
export const STALE_AFTER_MS = 30 * 24 * 3600_000;
export const MAX_DESKTOPS = 20;
export const MAX_PROJECTS = 50;

const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
// Hostnames, IPv4 and IPv6 — no scheme, path or port (the port comes from each project).
const HOST_RE = /^[A-Za-z0-9.:-]{1,255}$/;

function cleanText(value: unknown, max: number, field: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${field} required`);
  return text.slice(0, max);
}

function cleanHost(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const host = String(value).trim();
  if (!HOST_RE.test(host)) throw new Error(`${field} must be a bare host or IP (no scheme, path or port)`);
  return host;
}

function cleanProjects(value: unknown): DesktopProject[] {
  if (!Array.isArray(value)) return [];
  if (value.length > MAX_PROJECTS) throw new Error(`too many projects (max ${MAX_PROJECTS})`);
  return value.map((raw, i) => {
    const p = (raw ?? {}) as Record<string, unknown>;
    const port = Number(p.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`projects[${i}].port must be 1-65535`);
    return {
      id: cleanText(p.id, 128, `projects[${i}].id`),
      name: cleanText(p.name, 120, `projects[${i}].name`),
      port,
    };
  });
}

/**
 * Directory of desktops that published their gateways to this (Railway) hub, so
 * the phone can find them without typing an IP, port or key. Persisted on the
 * volume; "online" is derived from the last heartbeat.
 */
export class DesktopRegistry {
  private records: Record<string, DesktopRecord> = {};

  constructor(
    private readonly file: string,
    private readonly now: () => number = Date.now,
  ) {}

  async load(): Promise<void> {
    this.records = await readJsonFile<Record<string, DesktopRecord>>(this.file, {});
    await this.prune();
  }

  private async prune(): Promise<void> {
    const cutoff = this.now() - STALE_AFTER_MS;
    let changed = false;
    for (const [id, r] of Object.entries(this.records)) {
      if (r.lastSeen < cutoff) {
        delete this.records[id];
        changed = true;
      }
    }
    if (changed) await writeJsonFile(this.file, this.records);
  }

  /** Creates or refreshes a desktop (also the heartbeat). Throws on invalid input. */
  async register(input: Record<string, unknown>): Promise<DesktopView> {
    const desktopId = String(input.desktopId ?? "").trim();
    if (!ID_RE.test(desktopId)) throw new Error("desktopId must be 6-64 chars of letters, digits, _ or -");
    const existing = this.records[desktopId];
    if (!existing && Object.keys(this.records).length >= MAX_DESKTOPS) {
      throw new Error(`too many desktops registered (max ${MAX_DESKTOPS}); remove one first`);
    }
    const endpointsIn = (input.endpoints ?? {}) as Record<string, unknown>;
    const endpoints: DesktopEndpoints = {};
    const lan = cleanHost(endpointsIn.lan, "endpoints.lan");
    const tailscale = cleanHost(endpointsIn.tailscale, "endpoints.tailscale");
    if (lan) endpoints.lan = lan;
    if (tailscale) endpoints.tailscale = tailscale;

    const gatewayKey = input.gatewayKey === undefined || input.gatewayKey === "" ? undefined : String(input.gatewayKey);
    if (gatewayKey !== undefined && gatewayKey.length > 256) throw new Error("gatewayKey too long");

    const now = this.now();
    const record: DesktopRecord = {
      desktopId,
      name: cleanText(input.name, 80, "name"),
      projects: cleanProjects(input.projects),
      endpoints,
      ...(gatewayKey ? { gatewayKey } : {}),
      registeredAt: existing?.registeredAt ?? now,
      lastSeen: now,
    };
    this.records[desktopId] = record;
    await writeJsonFile(this.file, this.records);
    return this.view(record);
  }

  private view(r: DesktopRecord): DesktopView {
    return { ...r, online: this.now() - r.lastSeen <= ONLINE_WINDOW_MS };
  }

  /** The published gateway key of one desktop (the tunnel checks phones against it). */
  gatewayKeyOf(desktopId: string): string | undefined {
    return this.records[desktopId]?.gatewayKey;
  }

  /** Newest first; online ones before offline ones. */
  list(): DesktopView[] {
    return Object.values(this.records)
      .map((r) => this.view(r))
      .sort((a, b) => Number(b.online) - Number(a.online) || b.lastSeen - a.lastSeen);
  }

  /** Marks a desktop offline right away (it closed) without forgetting it. */
  async goOffline(desktopId: string): Promise<boolean> {
    const r = this.records[desktopId];
    if (!r) return false;
    r.lastSeen = Math.min(r.lastSeen, this.now() - ONLINE_WINDOW_MS - 1);
    r.projects = [];
    await writeJsonFile(this.file, this.records);
    return true;
  }

  async remove(desktopId: string): Promise<boolean> {
    if (!this.records[desktopId]) return false;
    delete this.records[desktopId];
    await writeJsonFile(this.file, this.records);
    return true;
  }
}
