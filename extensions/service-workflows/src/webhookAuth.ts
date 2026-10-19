import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * `trigger.secretRef` (workflows-design.md §3/§7.3) names an environment
 * variable holding the webhook secret — never a value stored in the
 * committed workflow JSON or in any gateway-reachable state file. Whoever
 * runs the gateway sets that env var; nothing in this build ever persists or
 * returns the secret itself.
 */
export function resolveWebhookSecret(secretRef: string): string | undefined {
  const value = process.env[secretRef];
  return value && value.length > 0 ? value : undefined;
}

export type WebhookAuthResult = { ok: true } | { ok: false; reason: "misconfigured" | "unauthorized" };

/**
 * Accepts either `Authorization: Bearer <secret>` (any method) or, for a
 * POST body, `X-Ygg-Signature: <hex sha256 HMAC of the raw body>` — see
 * workflows-design.md §7.3. Both compare with a constant-time check.
 */
export function verifyWebhookAuth(params: {
  secretRef: string;
  bearerToken?: string;
  signatureHex?: string;
  rawBody?: string;
}): WebhookAuthResult {
  const secret = resolveWebhookSecret(params.secretRef);
  if (!secret) return { ok: false, reason: "misconfigured" };

  if (params.bearerToken && constantTimeStringEqual(params.bearerToken, secret)) return { ok: true };

  if (params.signatureHex && params.rawBody !== undefined) {
    const expected = createHmac("sha256", secret).update(params.rawBody, "utf8").digest("hex");
    if (constantTimeStringEqual(params.signatureHex, expected)) return { ok: true };
  }

  return { ok: false, reason: "unauthorized" };
}

function constantTimeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Simple in-memory sliding window: 10 requests/min per workflow id (workflows-design.md §7.3). Not persisted — a gateway restart resets it, which is fine for abuse-throttling. */
export class WebhookRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly maxPerWindow = 10,
    private readonly windowMs = 60_000,
  ) {}

  /** Records this call as a hit and returns whether it's within the limit. */
  allow(key: string, now: number = Date.now()): boolean {
    const windowStart = now - this.windowMs;
    const existing = (this.hits.get(key) ?? []).filter((t) => t > windowStart);
    if (existing.length >= this.maxPerWindow) {
      this.hits.set(key, existing);
      return false;
    }
    existing.push(now);
    this.hits.set(key, existing);
    return true;
  }
}
