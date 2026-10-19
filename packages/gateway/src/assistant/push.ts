import { createSign } from "node:crypto";
import { readJsonFile, writeJsonFile } from "./jsonFile.js";

export type PushDevice = { deviceId: string; token: string; updatedAt: number };

/** Persists the FCM registration token of each phone (one per stable deviceId). */
export class PushStore {
  private devices: Record<string, PushDevice> = {};

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    this.devices = await readJsonFile<Record<string, PushDevice>>(this.file, {});
  }

  list(): PushDevice[] {
    return Object.values(this.devices);
  }

  async upsert(deviceId: string, token: string): Promise<void> {
    this.devices[deviceId] = { deviceId, token, updatedAt: Date.now() };
    await writeJsonFile(this.file, this.devices);
  }

  async remove(deviceId: string): Promise<boolean> {
    if (!this.devices[deviceId]) return false;
    delete this.devices[deviceId];
    await writeJsonFile(this.file, this.devices);
    return true;
  }
}

type ServiceAccount = { project_id: string; client_email: string; private_key: string; token_uri?: string };

export function parseServiceAccount(raw: string | undefined): ServiceAccount | null {
  if (!raw?.trim()) return null;
  try {
    const sa = JSON.parse(raw) as Partial<ServiceAccount>;
    if (!sa.project_id || !sa.client_email || !sa.private_key) return null;
    return sa as ServiceAccount;
  } catch {
    return null;
  }
}

const b64url = (input: Buffer | string): string =>
  Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

export type PushMessage = {
  title: string;
  body: string;
  /** FCM data values must be strings. */
  data?: Record<string, string>;
};

export type SendOutcome = { ok: true } | { ok: false; unregistered: boolean; error: string };

/**
 * Minimal FCM HTTP v1 client: signs a service-account JWT (RS256) with
 * node:crypto, trades it for an OAuth token and posts to messages:send — no
 * firebase-admin dependency. The service account (FCM_SERVICE_ACCOUNT_JSON)
 * only ever lives in the gateway's environment.
 */
export class FcmSender {
  private readonly account: ServiceAccount | null;
  private readonly fetchFn: typeof fetch;
  private cached: { token: string; expiresAt: number } | null = null;

  constructor(options: { serviceAccountJson?: string; fetchImpl?: typeof fetch }) {
    this.account = parseServiceAccount(options.serviceAccountJson);
    this.fetchFn = options.fetchImpl ?? fetch;
  }

  get configured(): boolean {
    return this.account !== null;
  }

  private async accessToken(): Promise<string> {
    const account = this.account!;
    const now = Date.now();
    if (this.cached && this.cached.expiresAt - 60_000 > now) return this.cached.token;

    const iat = Math.floor(now / 1000);
    const tokenUri = account.token_uri ?? "https://oauth2.googleapis.com/token";
    const unsigned =
      `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.` +
      b64url(
        JSON.stringify({
          iss: account.client_email,
          scope: "https://www.googleapis.com/auth/firebase.messaging",
          aud: tokenUri,
          iat,
          exp: iat + 3600,
        }),
      );
    const signature = createSign("RSA-SHA256").update(unsigned).sign(account.private_key);
    const assertion = `${unsigned}.${b64url(signature)}`;

    const res = await this.fetchFn(tokenUri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
    if (!res.ok || !body.access_token) {
      throw new Error(`FCM auth failed (${res.status}): ${body.error_description ?? "no access_token"}`);
    }
    this.cached = { token: body.access_token, expiresAt: now + (body.expires_in ?? 3600) * 1000 };
    return body.access_token;
  }

  async send(token: string, message: PushMessage): Promise<SendOutcome> {
    if (!this.account) return { ok: false, unregistered: false, error: "FCM not configured" };
    try {
      const res = await this.fetchFn(`https://fcm.googleapis.com/v1/projects/${this.account.project_id}/messages:send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await this.accessToken()}` },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: message.title, body: message.body },
            data: message.data ?? {},
            android: { priority: "HIGH", notification: { channel_id: "yggdrasil_alerts" } },
          },
        }),
      });
      if (res.ok) return { ok: true };
      const text = await res.text();
      // 404 UNREGISTERED / 400 INVALID_ARGUMENT: the token is dead (app reinstalled, data cleared).
      const unregistered = res.status === 404 || /UNREGISTERED|registration token is not a valid/i.test(text);
      return { ok: false, unregistered, error: `FCM send failed (${res.status}): ${text.slice(0, 700)}` };
    } catch (e) {
      return { ok: false, unregistered: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}

export type NotifyResult = { configured: boolean; devices: number; sent: number; failed: number; removed: number; errors: string[] };

export class PushService {
  constructor(
    private readonly store: PushStore,
    private readonly sender: FcmSender,
  ) {}

  get configured(): boolean {
    return this.sender.configured;
  }

  deviceCount(): number {
    return this.store.list().length;
  }

  register(deviceId: string, token: string): Promise<void> {
    return this.store.upsert(deviceId, token);
  }

  unregister(deviceId: string): Promise<boolean> {
    return this.store.remove(deviceId);
  }

  /** Sends to every registered phone; dead tokens are dropped. Never throws. */
  async notify(message: PushMessage): Promise<NotifyResult> {
    const devices = this.store.list();
    const result: NotifyResult = { configured: this.configured, devices: devices.length, sent: 0, failed: 0, removed: 0, errors: [] };
    if (!this.configured) return result;
    for (const d of devices) {
      const outcome = await this.sender.send(d.token, message);
      if (outcome.ok) {
        result.sent++;
        continue;
      }
      result.failed++;
      result.errors.push(outcome.error);
      if (outcome.unregistered && (await this.store.remove(d.deviceId))) result.removed++;
    }
    return result;
  }
}
