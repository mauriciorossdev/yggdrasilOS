import { randomBytes } from "node:crypto";
import WebSocket from "ws";

/**
 * Phone link (notes/asistente-personal/enlace-escritorio.md, phase E2): the
 * desktop publishes its open project gateways to the user's link server
 * ("hub"), so the phone finds them without typing an IP, a port that changes
 * every launch, or a key. Electron-free on purpose so it can be unit-tested;
 * phoneLink.ts wires it to settings, projects and IPC.
 */

export type PhoneLinkSettings = {
  /** Link server URL (https://… or wss://…). */
  hubUrl?: string;
  /** Link server API key (YGGDRASIL_API_KEY there). */
  hubKey?: string;
  /** Publish this desktop to the hub (and require a key on its own gateways). */
  publish?: boolean;
  /** Stable id of this desktop in the hub's directory. */
  desktopId?: string;
  /** Key this desktop's project gateways require from non-local clients. */
  gatewayKey?: string;
};

export type OpenProject = { id: string; name: string; port: number };

export type PublishStatus = {
  state: "disabled" | "ok" | "error" | "idle";
  lastOkAt?: number;
  lastAttemptAt?: number;
  lastError?: string;
};

/** The user's connection test, with one reason per way it can fail. */
export type HubTestResult =
  | { ok: true; desktops: number; insecure: boolean }
  | {
      ok: false;
      code: "invalid-url" | "insecure" | "missing-key" | "unreachable" | "not-yggdrasil" | "bad-key" | "server-open" | "no-directory";
      detail?: string;
    };

type NetIface = { address: string; family: string | number; internal: boolean };

/** Hex, so it survives any shell, .env or YAML file it gets pasted into. */
export function newHubKey(): string {
  return randomBytes(32).toString("hex");
}

export function newDesktopId(): string {
  return `desk-${randomBytes(9).toString("base64url")}`;
}

export function newGatewayKey(): string {
  return `ygd_${randomBytes(24).toString("base64url")}`;
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Tailscale hands out CGNAT addresses: 100.64.0.0/10. */
export function isTailscaleIPv4(address: string): boolean {
  if (!IPV4.test(address)) return false;
  const parts = address.split(".").map(Number);
  return parts[0] === 100 && parts[1]! >= 64 && parts[1]! <= 127;
}

/** 169.254.0.0/16: what an adapter gives itself with no network behind it (an idle VPN, an unplugged cable). */
function isLinkLocalIPv4(address: string): boolean {
  return IPV4.test(address) && address.startsWith("169.254.");
}

function isPrivateIPv4(address: string): boolean {
  if (!IPV4.test(address)) return false;
  const [a, b] = address.split(".").map(Number);
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b! >= 16 && b! <= 31);
}

/** Adapters of VMs and containers (WSL, Hyper-V, Docker, ...): private addresses, but a phone can't reach them. */
const VIRTUAL_IFACE = /vethernet|virtualbox|vboxnet|vmware|vmnet|hyper-v|wsl|docker|^veth|^br-|^virbr/i;

/** Lower is better: a real private network, then any other address, then a virtual adapter. */
function lanRank(name: string, address: string): number {
  if (VIRTUAL_IFACE.test(name)) return 2;
  return isPrivateIPv4(address) ? 0 : 1;
}

/** The best IPv4 for reaching this machine on the LAN and, separately, the Tailscale one (if any). */
export function pickAddresses(ifaces: Record<string, NetIface[] | undefined>): { lan?: string; tailscale?: string } {
  let lan: { address: string; rank: number } | undefined;
  let tailscale: string | undefined;
  for (const [name, list] of Object.entries(ifaces)) {
    for (const i of list ?? []) {
      const v4 = i.family === "IPv4" || i.family === 4;
      if (!v4 || i.internal || isLinkLocalIPv4(i.address)) continue;
      if (isTailscaleIPv4(i.address)) {
        tailscale ??= i.address;
        continue;
      }
      const rank = lanRank(name, i.address);
      if (!lan || rank < lan.rank) lan = { address: i.address, rank };
    }
  }
  return { ...(lan ? { lan: lan.address } : {}), ...(tailscale ? { tailscale } : {}) };
}

/** https -> wss, http -> ws, bare host -> wss; no trailing slash. */
export function hubWsUrl(hubUrl: string): string {
  const trimmed = hubUrl.trim().replace(/\/+$/, "");
  if (/^wss?:\/\//i.test(trimmed)) return trimmed;
  if (/^https:\/\//i.test(trimmed)) return trimmed.replace(/^https:/i, "wss:");
  if (/^http:\/\//i.test(trimmed)) return trimmed.replace(/^http:/i, "ws:");
  return `wss://${trimmed}`;
}

/** A host only reachable from this network or tailnet, where traffic doesn't cross the open internet. */
function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "::1" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host)) return host.includes(":");
  if (IPV4.test(host)) return host.startsWith("127.") || isPrivateIPv4(host) || isLinkLocalIPv4(host) || isTailscaleIPv4(host);
  return !host.includes(".") || /\.(localhost|local|lan|home\.arpa|ts\.net)$/.test(host);
}

export type HubUrlCheck = "empty" | "ok" | "insecure-local" | "insecure-public" | "invalid";

/**
 * Decides whether the hub key may travel to this URL. Unencrypted is only
 * acceptable inside a local network or tailnet: on the open internet it would
 * expose the hub key and, through desktops.list, every desktop's gateway key.
 */
export function checkHubUrl(hubUrl: string): HubUrlCheck {
  const trimmed = hubUrl.trim();
  if (!trimmed) return "empty";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !/^(https?|wss?):\/\/[^/]/i.test(trimmed)) return "invalid";
  let url: URL;
  try {
    url = new URL(hubWsUrl(trimmed));
  } catch {
    return "invalid";
  }
  if (!url.hostname) return "invalid";
  if (url.protocol === "wss:") return "ok";
  return isLocalHost(url.hostname) ? "insecure-local" : "insecure-public";
}

/**
 * True when saving would send the saved key to a different server: a mistyped
 * domain would otherwise receive it on the next publish. Clearing the URL is fine.
 */
export function savedKeyWouldMove(saved: { hubUrl?: string; hubKey?: string }, input: { hubUrl?: string; hubKey?: string }): boolean {
  if (typeof input.hubUrl !== "string" || input.hubKey?.trim() || !saved.hubKey) return false;
  const next = input.hubUrl.trim();
  return !!next && next !== (saved.hubUrl ?? "").trim();
}

function isUsableHubUrl(hubUrl: string): boolean {
  const check = checkHubUrl(hubUrl);
  return check === "ok" || check === "insecure-local";
}

/** What the desktop's QR encodes; the app's yggdrasil://hub handler reads it. */
export function hubQrPayload(hubUrl: string, hubKey: string): string {
  // A bare host works here (see hubWsUrl), but the app only accepts full URLs.
  const trimmed = hubUrl.trim();
  const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return `yggdrasil://hub?url=${encodeURIComponent(url)}&key=${encodeURIComponent(hubKey.trim())}`;
}

/** "Alexs-MacBook-Pro.local" -> "Alexs-MacBook-Pro". */
export function friendlyHostName(host: string): string {
  return host.replace(/\.local$/i, "").trim() || "Desktop";
}

export function isPublishable(s: PhoneLinkSettings): boolean {
  return !!(s.publish && s.hubUrl?.trim() && isUsableHubUrl(s.hubUrl) && s.hubKey?.trim() && s.desktopId && s.gatewayKey);
}

export function buildRegistration(
  s: PhoneLinkSettings,
  name: string,
  projects: OpenProject[],
  addresses: { lan?: string; tailscale?: string },
): Record<string, unknown> {
  return {
    desktopId: s.desktopId,
    name,
    projects,
    endpoints: addresses,
    gatewayKey: s.gatewayKey,
  };
}

/** The hub answered with an error, at the auth step or at the call itself. */
export class HubError extends Error {
  constructor(
    message: string,
    readonly stage: "auth" | "call",
    readonly code?: string,
  ) {
    super(message);
  }
}

/** One authenticated JSON-RPC call to the hub over a short-lived WebSocket. */
export function hubCall(
  hubUrl: string,
  hubKey: string,
  method: string,
  params: Record<string, unknown>,
  options: { timeoutMs?: number; WebSocketImpl?: typeof WebSocket } = {},
): Promise<unknown> {
  const Impl = options.WebSocketImpl ?? WebSocket;
  return new Promise((resolve, reject) => {
    const ws = new Impl(hubWsUrl(hubUrl));
    let settled = false;
    const finish = (err: Error | null, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // already closing
      }
      if (err) reject(err);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error("hub did not answer in time")), options.timeoutMs ?? 10_000);
    ws.on("open", () => ws.send(JSON.stringify({ id: "auth", method: "auth", params: { apiKey: hubKey } })));
    ws.on("message", (raw: WebSocket.RawData) => {
      let msg: { id?: string; result?: unknown; error?: { code?: string; message?: string } };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.id === "auth") {
        if (msg.error) return finish(new HubError(`hub rejected the key: ${msg.error.message ?? "unauthorized"}`, "auth", msg.error.code));
        ws.send(JSON.stringify({ id: "call", method, params }));
      } else if (msg.id === "call") {
        if (msg.error) finish(new HubError(msg.error.message ?? "hub error", "call", msg.error.code));
        else finish(null, msg.result);
      }
    });
    ws.on("error", (e: Error) => finish(e));
    ws.on("close", () => finish(new Error("hub closed the connection")));
  });
}

/**
 * Checks a link server end to end. Confirms over plain HTTP that it is a
 * Yggdrasil gateway before sending it the key, so a mistyped URL never receives it.
 */
export async function testHubConnection(
  hubUrl: string,
  hubKey: string,
  options: { fetchImpl?: typeof fetch; call?: typeof hubCall; timeoutMs?: number } = {},
): Promise<HubTestResult> {
  const check = checkHubUrl(hubUrl);
  if (check === "empty" || check === "invalid") return { ok: false, code: "invalid-url" };
  if (check === "insecure-public") return { ok: false, code: "insecure" };
  if (!hubKey.trim()) return { ok: false, code: "missing-key" };

  const timeoutMs = options.timeoutMs ?? 8_000;
  const httpUrl = `${hubWsUrl(hubUrl).replace(/^ws/i, "http")}/`;
  let body: string;
  try {
    const response = await (options.fetchImpl ?? fetch)(httpUrl, { signal: AbortSignal.timeout(timeoutMs) });
    body = await response.text();
  } catch (e) {
    const cause = (e as { cause?: { code?: string; message?: string } }).cause;
    return { ok: false, code: "unreachable", detail: cause?.code ?? cause?.message ?? (e instanceof Error ? e.message : String(e)) };
  }
  let service: unknown;
  try {
    service = (JSON.parse(body) as { service?: unknown }).service;
  } catch {
    service = undefined;
  }
  if (service !== "yggdrasil-gateway") return { ok: false, code: "not-yggdrasil" };

  try {
    const result = await (options.call ?? hubCall)(hubUrl, hubKey, "desktops.list", {}, { timeoutMs });
    const desktops = (result as { desktops?: unknown[] } | null)?.desktops;
    return { ok: true, desktops: Array.isArray(desktops) ? desktops.length : 0, insecure: check === "insecure-local" };
  } catch (e) {
    if (!(e instanceof HubError)) return { ok: false, code: "unreachable", detail: e instanceof Error ? e.message : String(e) };
    if (e.stage === "call") return { ok: false, code: "no-directory", detail: e.message };
    // Only a gateway with no key configured has no "auth" method to call.
    return e.code === "METHOD_NOT_FOUND" ? { ok: false, code: "server-open" } : { ok: false, code: "bad-key" };
  }
}

/**
 * Asks a project gateway on this machine whether it requires a key. Gateways
 * opened before publishing was switched on run without one: the phone can't
 * authenticate against them, so they are left out of the hub until reopened.
 * Null when the gateway doesn't answer.
 */
export function localGatewayRequiresKey(
  port: number,
  options: { host?: string; timeoutMs?: number; WebSocketImpl?: typeof WebSocket } = {},
): Promise<boolean | null> {
  const Impl = options.WebSocketImpl ?? WebSocket;
  return new Promise((resolve) => {
    const ws = new Impl(`ws://${options.host ?? "127.0.0.1"}:${port}`);
    let settled = false;
    const finish = (value: boolean | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // already closing
      }
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), options.timeoutMs ?? 3_000);
    ws.on("open", () => ws.send(JSON.stringify({ id: "health", method: "health", params: {} })));
    ws.on("message", (raw: WebSocket.RawData) => {
      let msg: { id?: string; result?: { keyConfigured?: boolean }; error?: { code?: string } };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.id !== "health") return;
      // A keyed gateway without loopback trust rejects even this call.
      if (msg.error) finish(msg.error.code === "UNAUTHORIZED");
      // Not health.authRequired: this probe is itself a loopback connection,
      // so a keyed gateway's own trusted-loopback override would otherwise
      // make it read as unkeyed forever (see server.ts's health override).
      else finish(msg.result?.keyConfigured === true);
    });
    ws.on("error", () => finish(null));
    ws.on("close", () => finish(null));
  });
}

export type PublisherDeps = {
  getSettings: () => Promise<PhoneLinkSettings>;
  getProjects: () => Promise<OpenProject[]>;
  getHostName: () => string;
  getAddresses: () => { lan?: string; tailscale?: string };
  call?: typeof hubCall;
  intervalMs?: number;
  now?: () => number;
};

/**
 * Announces this desktop to the hub on start, on demand (project opened or
 * closed) and every minute (the hub shows it offline after 90 s without news).
 */
export class HubPublisher {
  status: PublishStatus = { state: "idle" };
  private timer: ReturnType<typeof setInterval> | null = null;
  private inflight: Promise<PublishStatus> | null = null;

  constructor(private readonly deps: PublisherDeps) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.publishNow(), this.deps.intervalMs ?? 60_000);
    this.timer.unref?.();
    void this.publishNow();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Concurrent callers share one attempt. Never throws. */
  publishNow(): Promise<PublishStatus> {
    this.inflight ??= this.doPublish().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async doPublish(): Promise<PublishStatus> {
    const now = this.deps.now ?? Date.now;
    const s = await this.deps.getSettings();
    if (!isPublishable(s)) {
      this.status = { state: "disabled" };
      return this.status;
    }
    const attemptAt = now();
    try {
      const payload = buildRegistration(s, this.deps.getHostName(), await this.deps.getProjects(), this.deps.getAddresses());
      await (this.deps.call ?? hubCall)(s.hubUrl!, s.hubKey!, "desktops.register", payload);
      this.status = { state: "ok", lastOkAt: attemptAt, lastAttemptAt: attemptAt };
    } catch (e) {
      this.status = {
        state: "error",
        lastAttemptAt: attemptAt,
        lastOkAt: this.status.lastOkAt,
        lastError: e instanceof Error ? e.message : String(e),
      };
    }
    return this.status;
  }

  /** Best effort on quit: tell the hub right away instead of waiting out the 90 s window. */
  async goOffline(timeoutMs = 1500): Promise<void> {
    const s = await this.deps.getSettings();
    if (!isPublishable(s)) return;
    try {
      await (this.deps.call ?? hubCall)(s.hubUrl!, s.hubKey!, "desktops.offline", { desktopId: s.desktopId }, { timeoutMs });
    } catch {
      // quitting anyway
    }
  }
}
