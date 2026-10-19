import WebSocket from "ws";
import { hubWsUrl, isPublishable, type PhoneLinkSettings } from "./phoneLinkCore.js";

/**
 * Desktop end of the phone-link tunnel (phase B): one outbound socket to the
 * Railway hub (/tunnel-host/<desktopId>); for every phone channel the hub opens,
 * a socket to that project's local gateway, piping text frames both ways. The
 * local socket carries `x-yggdrasil-tunnel: 1` so the gateway treats it as a
 * remote client (key required, no loopback trust) — it is the phone, not us.
 * See packages/gateway/src/tunnel.ts for the hub side and the frame format.
 */

export type TunnelState = "disabled" | "connecting" | "connected" | "error";

export type TunnelDeps = {
  getSettings: () => Promise<PhoneLinkSettings>;
  /** Current local port of a project's gateway, if that project is open. */
  getProjectPort: (projectId: string) => Promise<number | undefined>;
  /** Backoff between reconnects, in ms (last value repeats). */
  retryDelaysMs?: number[];
  localHost?: string;
};

// local is null while the project's port is being looked up; frames queue in pending.
type Channel = { local: WebSocket | null; pending: string[] };

export class TunnelClient {
  state: TunnelState = "disabled";
  lastError?: string;
  private host: WebSocket | null = null;
  private readonly channels = new Map<string, Channel>();
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;

  constructor(private readonly deps: TunnelDeps) {}

  /** Starts (or restarts, e.g. after settings changed) the link if publishing is on. */
  async start(): Promise<void> {
    this.stopped = false;
    this.teardown();
    const s = await this.deps.getSettings();
    if (!isPublishable(s)) {
      this.state = "disabled";
      return;
    }
    this.connect(s);
  }

  stop(): void {
    this.stopped = true;
    this.teardown();
    this.state = "disabled";
  }

  private teardown(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const host = this.host;
    this.host = null;
    host?.removeAllListeners();
    host?.terminate();
    for (const ch of this.channels.values()) ch.local?.terminate();
    this.channels.clear();
  }

  private send(msg: Record<string, unknown>): void {
    if (this.host?.readyState === WebSocket.OPEN) this.host.send(JSON.stringify(msg));
  }

  private connect(s: PhoneLinkSettings): void {
    this.state = "connecting";
    const host = new WebSocket(`${hubWsUrl(s.hubUrl!)}/tunnel-host/${s.desktopId}`);
    this.host = host;
    host.on("open", () => host.send(JSON.stringify({ t: "auth", key: s.hubKey })));
    host.on("message", (raw) => void this.onHostMessage(String(raw)));
    host.on("error", (e) => {
      this.lastError = e.message;
    });
    host.on("close", (code, reason) => {
      if (this.host !== host) return;
      this.host = null;
      for (const ch of this.channels.values()) ch.local?.close();
      this.channels.clear();
      if (code === 4401) this.lastError = "Railway rechazó la clave";
      else if (reason.length) this.lastError = reason.toString();
      this.state = "error";
      this.scheduleRetry();
    });
  }

  private scheduleRetry(): void {
    if (this.stopped) return;
    const delays = this.deps.retryDelaysMs ?? [1_000, 2_000, 5_000, 10_000, 30_000];
    const delay = delays[Math.min(this.attempt, delays.length - 1)]!;
    this.attempt++;
    this.retryTimer = setTimeout(() => void this.start(), delay);
    this.retryTimer.unref?.();
  }

  private async onHostMessage(raw: string): Promise<void> {
    let msg: { t?: string; ch?: string; d?: string; projectId?: string; reason?: string };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    switch (msg.t) {
      case "ready":
        this.state = "connected";
        this.attempt = 0;
        this.lastError = undefined;
        return;
      case "error":
        this.lastError = msg.reason ?? "error";
        return;
      case "open":
        if (msg.ch) await this.openChannel(msg.ch, msg.projectId ?? "");
        return;
      case "data": {
        const ch = msg.ch ? this.channels.get(msg.ch) : undefined;
        if (!ch || typeof msg.d !== "string") return;
        if (ch.local?.readyState === WebSocket.OPEN) ch.local.send(msg.d);
        else ch.pending.push(msg.d);
        return;
      }
      case "close": {
        const ch = msg.ch ? this.channels.get(msg.ch) : undefined;
        if (!ch) return;
        this.channels.delete(msg.ch!);
        ch.local?.close();
        return;
      }
    }
  }

  private async openChannel(chId: string, projectId: string): Promise<void> {
    // Register the channel before any await: the hub sends the phone's first
    // frame (its auth) right after "open", and it must queue, not be dropped.
    const ch: Channel = { local: null, pending: [] };
    this.channels.set(chId, ch);
    const port = await this.deps.getProjectPort(projectId);
    if (this.channels.get(chId) !== ch) return; // closed meanwhile
    if (!port) {
      this.channels.delete(chId);
      this.send({ t: "close", ch: chId, reason: "project not open on this desktop" });
      return;
    }
    const local = new WebSocket(`ws://${this.deps.localHost ?? "127.0.0.1"}:${port}`, {
      headers: { "x-yggdrasil-tunnel": "1" },
    });
    ch.local = local;
    local.on("open", () => {
      for (const d of ch.pending.splice(0)) local.send(d);
    });
    local.on("message", (raw) => this.send({ t: "data", ch: chId, d: String(raw) }));
    local.on("close", () => {
      if (this.channels.get(chId) !== ch) return;
      this.channels.delete(chId);
      this.send({ t: "close", ch: chId });
    });
    local.on("error", () => local.terminate());
  }
}
