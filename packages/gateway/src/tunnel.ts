import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type RawData, type WebSocket } from "ws";

/**
 * Phone link phase B (notes/asistente-personal/enlace-escritorio.md): a relay so
 * the phone reaches a desktop from any network, no VPN. The desktop keeps one
 * outbound socket here (/tunnel-host/<desktopId>, authenticated with the hub
 * key); each phone socket on /tunnel/<desktopId>/<projectId> becomes a channel
 * multiplexed over it. The phone's first message must be its normal
 * `{method:"auth"}` carrying that desktop's gateway key — checked here before
 * anything is relayed, and checked again end to end by the desktop's own gateway.
 *
 * Host protocol (JSON text frames):
 *   desktop -> hub: {t:"auth", key} | {t:"data", ch, d} | {t:"close", ch, reason?}
 *   hub -> desktop: {t:"ready"} | {t:"error", reason} | {t:"open", ch, projectId} | {t:"data", ch, d} | {t:"close", ch}
 */

export const TUNNEL_HOST_PATH = /^\/tunnel-host\/([A-Za-z0-9_-]{6,64})\/?$/;
export const TUNNEL_CLIENT_PATH = /^\/tunnel\/([A-Za-z0-9_-]{6,64})\/([^/]{1,128})\/?$/;

export const MAX_CHANNELS_PER_DESKTOP = 20;
const AUTH_TIMEOUT_MS = 10_000;
const PING_MS = 25_000;
const MAX_FRAME_BYTES = 32 * 1024 * 1024;

export type TunnelHubOptions = {
  /** True if [apiKey] is this hub's own key (desktops attaching). */
  validateHostKey: (apiKey: string) => boolean;
  /** The gateway key a desktop published (phones must present it). */
  desktopKey: (desktopId: string) => string | undefined;
};

type HostLink = { ws: WebSocket; channels: Map<string, WebSocket> };

function text(raw: RawData): string {
  return Array.isArray(raw) ? Buffer.concat(raw).toString("utf8") : Buffer.from(raw as ArrayBuffer).toString("utf8");
}

function parse(raw: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function keepAlive(ws: WebSocket): () => void {
  const timer = setInterval(() => {
    try {
      ws.ping();
    } catch {
      // closing
    }
  }, PING_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

export class TunnelHub {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  private readonly hosts = new Map<string, HostLink>();

  constructor(private readonly opts: TunnelHubOptions) {}

  /** Takes over the upgrade if the path is a tunnel path; returns whether it did. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    const host = TUNNEL_HOST_PATH.exec(path);
    if (host) {
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onHost(ws, host[1]!));
      return true;
    }
    const client = TUNNEL_CLIENT_PATH.exec(path);
    if (client) {
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onClient(ws, client[1]!, decodeURIComponent(client[2]!)));
      return true;
    }
    return false;
  }

  isAttached(desktopId: string): boolean {
    return this.hosts.has(desktopId);
  }

  close(): void {
    for (const link of this.hosts.values()) link.ws.terminate();
    this.hosts.clear();
    this.wss.close();
  }

  private send(ws: WebSocket, msg: Record<string, unknown>): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  private onHost(ws: WebSocket, desktopId: string): void {
    let attached = false;
    const stopPing = keepAlive(ws);
    const authTimer = setTimeout(() => {
      if (!attached) ws.close(4401, "auth timeout");
    }, AUTH_TIMEOUT_MS);

    ws.on("message", (raw) => {
      const msg = parse(text(raw));
      if (!msg) return;
      if (!attached) {
        if (msg.t !== "auth" || typeof msg.key !== "string" || !this.opts.validateHostKey(msg.key)) {
          this.send(ws, { t: "error", reason: "unauthorized" });
          ws.close(4401, "unauthorized");
          return;
        }
        clearTimeout(authTimer);
        // A desktop reconnecting replaces its old link (and that link's channels).
        const previous = this.hosts.get(desktopId);
        if (previous && previous.ws !== ws) previous.ws.close(4409, "replaced");
        this.hosts.set(desktopId, { ws, channels: new Map() });
        attached = true;
        this.send(ws, { t: "ready" });
        return;
      }
      const link = this.hosts.get(desktopId);
      if (!link || link.ws !== ws) return;
      const ch = typeof msg.ch === "string" ? msg.ch : "";
      const phone = link.channels.get(ch);
      if (!phone) return;
      if (msg.t === "data" && typeof msg.d === "string") {
        if (phone.readyState === phone.OPEN) phone.send(msg.d);
      } else if (msg.t === "close") {
        link.channels.delete(ch);
        phone.close(4000, typeof msg.reason === "string" ? msg.reason.slice(0, 100) : "closed by desktop");
      }
    });

    ws.on("close", () => {
      clearTimeout(authTimer);
      stopPing();
      const link = this.hosts.get(desktopId);
      if (link?.ws !== ws) return;
      this.hosts.delete(desktopId);
      for (const phone of link.channels.values()) phone.close(4503, "desktop disconnected");
    });
    ws.on("error", () => ws.terminate());
  }

  private onClient(phone: WebSocket, desktopId: string, projectId: string): void {
    let ch: string | null = null;
    const stopPing = keepAlive(phone);
    const authTimer = setTimeout(() => {
      if (!ch) phone.close(4401, "auth timeout");
    }, AUTH_TIMEOUT_MS);

    phone.on("message", (raw) => {
      const body = text(raw);
      const link = this.hosts.get(desktopId);
      if (!ch) {
        const msg = parse(body);
        const params = (msg?.params ?? {}) as Record<string, unknown>;
        const expected = this.opts.desktopKey(desktopId);
        if (!link) {
          this.send(phone, { id: msg?.id ?? null, error: { code: "UNAVAILABLE", message: "desktop offline (no tunnel)" } });
          phone.close(4404, "desktop offline");
          return;
        }
        if (msg?.method !== "auth" || !expected || params.apiKey !== expected) {
          this.send(phone, { id: msg?.id ?? null, error: { code: "UNAUTHORIZED", message: "wrong desktop key" } });
          phone.close(4401, "unauthorized");
          return;
        }
        if (link.channels.size >= MAX_CHANNELS_PER_DESKTOP) {
          this.send(phone, { id: msg.id ?? null, error: { code: "BUSY", message: "too many tunnel connections" } });
          phone.close(4429, "too many channels");
          return;
        }
        clearTimeout(authTimer);
        ch = randomUUID();
        link.channels.set(ch, phone);
        this.send(link.ws, { t: "open", ch, projectId });
        // The auth message goes through too: the desktop's gateway checks the key itself.
        this.send(link.ws, { t: "data", ch, d: body });
        return;
      }
      if (link?.channels.get(ch) === phone) this.send(link.ws, { t: "data", ch, d: body });
    });

    phone.on("close", () => {
      clearTimeout(authTimer);
      stopPing();
      if (!ch) return;
      const link = this.hosts.get(desktopId);
      if (link?.channels.get(ch) === phone) {
        link.channels.delete(ch);
        this.send(link.ws, { t: "close", ch });
      }
    });
    phone.on("error", () => phone.terminate());
  }
}
