import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { resolveWebhookSecret, verifyWebhookAuth, WebhookRateLimiter } from "./webhookAuth.js";

const SECRET_ENV = "YGG_TEST_WEBHOOK_SECRET";

describe("resolveWebhookSecret", () => {
  afterEach(() => {
    delete process.env[SECRET_ENV];
  });

  it("reads the secret from the named env var", () => {
    process.env[SECRET_ENV] = "s3cr3t";
    expect(resolveWebhookSecret(SECRET_ENV)).toBe("s3cr3t");
  });

  it("returns undefined when the env var is unset or empty", () => {
    expect(resolveWebhookSecret(SECRET_ENV)).toBeUndefined();
    process.env[SECRET_ENV] = "";
    expect(resolveWebhookSecret(SECRET_ENV)).toBeUndefined();
  });
});

describe("verifyWebhookAuth", () => {
  beforeEach(() => {
    process.env[SECRET_ENV] = "s3cr3t";
  });
  afterEach(() => {
    delete process.env[SECRET_ENV];
  });

  it("fails closed as misconfigured when the secret env var isn't set", () => {
    delete process.env[SECRET_ENV];
    const result = verifyWebhookAuth({ secretRef: SECRET_ENV, bearerToken: "anything" });
    expect(result).toEqual({ ok: false, reason: "misconfigured" });
  });

  it("accepts a correct bearer token", () => {
    const result = verifyWebhookAuth({ secretRef: SECRET_ENV, bearerToken: "s3cr3t" });
    expect(result).toEqual({ ok: true });
  });

  it("rejects a wrong bearer token", () => {
    const result = verifyWebhookAuth({ secretRef: SECRET_ENV, bearerToken: "wrong" });
    expect(result).toEqual({ ok: false, reason: "unauthorized" });
  });

  it("accepts a correct HMAC signature over the raw body", () => {
    const rawBody = JSON.stringify({ hello: "world" });
    const signatureHex = createHmac("sha256", "s3cr3t").update(rawBody, "utf8").digest("hex");
    const result = verifyWebhookAuth({ secretRef: SECRET_ENV, signatureHex, rawBody });
    expect(result).toEqual({ ok: true });
  });

  it("rejects a signature computed over a different body", () => {
    const signatureHex = createHmac("sha256", "s3cr3t").update("original", "utf8").digest("hex");
    const result = verifyWebhookAuth({ secretRef: SECRET_ENV, signatureHex, rawBody: "tampered" });
    expect(result).toEqual({ ok: false, reason: "unauthorized" });
  });

  it("rejects when neither bearer nor signature is provided", () => {
    const result = verifyWebhookAuth({ secretRef: SECRET_ENV });
    expect(result).toEqual({ ok: false, reason: "unauthorized" });
  });
});

describe("WebhookRateLimiter", () => {
  it("allows up to the configured limit within the window, then blocks", () => {
    const limiter = new WebhookRateLimiter(3, 60_000);
    const now = 1_000_000;
    expect(limiter.allow("wf1", now)).toBe(true);
    expect(limiter.allow("wf1", now + 1)).toBe(true);
    expect(limiter.allow("wf1", now + 2)).toBe(true);
    expect(limiter.allow("wf1", now + 3)).toBe(false);
  });

  it("tracks each key independently", () => {
    const limiter = new WebhookRateLimiter(1, 60_000);
    const now = 1_000_000;
    expect(limiter.allow("wf1", now)).toBe(true);
    expect(limiter.allow("wf2", now)).toBe(true);
    expect(limiter.allow("wf1", now)).toBe(false);
  });

  it("lets requests through again once the window has passed", () => {
    const limiter = new WebhookRateLimiter(1, 60_000);
    const now = 1_000_000;
    expect(limiter.allow("wf1", now)).toBe(true);
    expect(limiter.allow("wf1", now + 60_001)).toBe(true);
  });
});
