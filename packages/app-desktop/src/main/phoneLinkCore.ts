import { randomBytes } from "node:crypto";
import WebSocket from "ws";

/**
 * Phone link (notes/asistente-personal/enlace-escritorio.md, phase E2): the
 * desktop publishes its open project gateways to the user's Railway gateway
 * ("hub"), so the phone finds them without typing an IP, a port that changes
 * every launch, or a key. Electron-free on purpose so it can be unit-tested;
 * phoneLink.ts wires it to settings, projects and IPC.
 */

export type PhoneLinkSettings = {
  /** Railway gateway URL (https://… or wss://…). */
  hubUrl?: string;
  /** Railway gateway API key (YGGDRASIL_API_KEY there). */
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

type NetIface = { address: string; family: string | number; internal: boolean };

export function newDesktopId(): string {
  return `desk-${randomBytes(9).toString("base64url")}`;
}

export function newGatewayKey(): string {
  return `ygd_${randomBytes(24).toString("base64url")}`;
}

/** Tailscale hands out CGNAT addresses: 100.64.0.0/10. */
export function isTailscaleIPv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  return parts.length === 4 && parts[0] === 100 && parts[1]! >= 64 && parts[1]! <= 127;
}

/** First non-internal IPv4 on the LAN and, separately, the Tailscale one (if any). */
export function pickAddresses(ifaces: Record<string, NetIface[] | undefined>): { lan?: string; tailscale?: string } {
  let lan: string | undefined;
  let tailscale: string | undefined;
  for (const list of Object.values(ifaces)) {
    for (const i of list ?? []) {
      const v4 = i.family === "IPv4" || i.family === 4;
      if (!v4 || i.internal) continue;
      if (isTailscaleIPv4(i.address)) tailscale ??= i.address;
      else lan ??= i.address;
    }
  }
  return { ...(lan ? { lan } : {}), ...(tailscale ? { tailscale } : {}) };
}

/** https -> wss, http -> ws, bare host -> wss; no trailing slash. */
export function hubWsUrl(hubUrl: string): string {
  const trimmed = hubUrl.trim().replace(/\/+$/, "");
  if (/^wss?:\/\//i.test(trimmed)) return trimmed;
  if (/^https:\/\//i.test(trimmed)) return trimmed.replace(/^https:/i, "wss:");
  if (/^http:\/\//i.test(trimmed)) return trimmed.replace(/^http:/i, "ws:");
  return `wss://${trimmed}`;
}

/** What the desktop's QR encodes; the app's yggdrasil://hub handler reads it. */
export function hubQrPayload(hubUrl: string, hubKey: string): string {
  return `yggdrasil://hub?url=${encodeURIComponent(hubUrl.trim())}&key=${encodeURIComponent(hubKey.trim())}`;
}

/** "Alexs-MacBook-Pro.local" -> "Alexs-MacBook-Pro". */
export function friendlyHostName(host: string): string {
  return host.replace(/\.local$/i, "").trim() || "Desktop";
}

export function isPublishable(s: PhoneLinkSettings): boolean {
  return !!(s.publish && s.hubUrl?.trim() && s.hubKey?.trim() && s.desktopId && s.gatewayKey);
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
      let msg: { id?: string; result?: unknown; error?: { message?: string } };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.id === "auth") {
        if (msg.error) return finish(new Error(`hub rejected the key: ${msg.error.message ?? "unauthorized"}`));
        ws.send(JSON.stringify({ id: "call", method, params }));
      } else if (msg.id === "call") {
        if (msg.error) finish(new Error(msg.error.message ?? "hub error"));
        else finish(null, msg.result);
      }
    });
    ws.on("error", (e: Error) => finish(e));
    ws.on("close", () => finish(new Error("hub closed the connection")));
  });
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
