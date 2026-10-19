import { generateKeyPairSync, createVerify } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FcmSender, PushService, PushStore, parseServiceAccount } from "./push.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const account = JSON.stringify({ project_id: "proj-1", client_email: "svc@proj-1.iam.gserviceaccount.com", private_key: privateKey });

type Call = { url: string; init?: RequestInit };
function fakeFetch(handler: (call: Call) => Response) {
  const calls: Call[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return handler({ url, init });
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const oauthOk = () => new Response(JSON.stringify({ access_token: "ya29.test", expires_in: 3600 }), { status: 200 });

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "push-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("parseServiceAccount", () => {
  it("accepts a complete account and rejects junk", () => {
    expect(parseServiceAccount(account)?.project_id).toBe("proj-1");
    expect(parseServiceAccount(undefined)).toBeNull();
    expect(parseServiceAccount("not json")).toBeNull();
    expect(parseServiceAccount(JSON.stringify({ project_id: "x" }))).toBeNull();
  });
});

describe("FcmSender", () => {
  it("signs a verifiable RS256 JWT, calls messages:send and caches the OAuth token", async () => {
    const { fn, calls } = fakeFetch((c) => (c.url.includes("oauth2") ? oauthOk() : new Response("{}", { status: 200 })));
    const sender = new FcmSender({ serviceAccountJson: account, fetchImpl: fn });

    expect(await sender.send("tok-1", { title: "Hola", body: "Mundo", data: { type: "reminder" } })).toEqual({ ok: true });
    await sender.send("tok-2", { title: "b", body: "b" });

    const oauthCalls = calls.filter((c) => c.url.includes("oauth2"));
    expect(oauthCalls).toHaveLength(1); // second send reused the cached token

    const assertion = new URLSearchParams(String(oauthCalls[0]!.init?.body)).get("assertion")!;
    const [h, p, sig] = assertion.split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(p, "base64url").toString());
    expect(claims.iss).toBe("svc@proj-1.iam.gserviceaccount.com");
    expect(claims.scope).toBe("https://www.googleapis.com/auth/firebase.messaging");
    expect(claims.exp - claims.iat).toBe(3600);
    expect(createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(sig, "base64url"))).toBe(true);

    const send = calls.find((c) => c.url.includes("fcm.googleapis.com"))!;
    expect(send.url).toBe("https://fcm.googleapis.com/v1/projects/proj-1/messages:send");
    expect((send.init?.headers as Record<string, string>).Authorization).toBe("Bearer ya29.test");
    const body = JSON.parse(String(send.init?.body));
    expect(body.message).toMatchObject({
      token: "tok-1",
      notification: { title: "Hola", body: "Mundo" },
      data: { type: "reminder" },
      android: { priority: "HIGH", notification: { channel_id: "yggdrasil_alerts" } },
    });
  });

  it("flags dead tokens as unregistered and reports other failures", async () => {
    const dead = fakeFetch((c) =>
      c.url.includes("oauth2") ? oauthOk() : new Response('{"error":{"status":"NOT_FOUND","message":"UNREGISTERED"}}', { status: 404 }),
    );
    const r1 = await new FcmSender({ serviceAccountJson: account, fetchImpl: dead.fn }).send("t", { title: "a", body: "b" });
    expect(r1).toMatchObject({ ok: false, unregistered: true });

    const boom = fakeFetch((c) => (c.url.includes("oauth2") ? oauthOk() : new Response("quota", { status: 429 })));
    const r2 = await new FcmSender({ serviceAccountJson: account, fetchImpl: boom.fn }).send("t", { title: "a", body: "b" });
    expect(r2).toMatchObject({ ok: false, unregistered: false });

    const badAuth = fakeFetch(() => new Response(JSON.stringify({ error_description: "invalid_grant" }), { status: 400 }));
    const r3 = await new FcmSender({ serviceAccountJson: account, fetchImpl: badAuth.fn }).send("t", { title: "a", body: "b" });
    expect(r3).toMatchObject({ ok: false });
    expect((r3 as { error: string }).error).toMatch(/invalid_grant/);
  });

  it("is a no-op when no service account is configured", async () => {
    const sender = new FcmSender({});
    expect(sender.configured).toBe(false);
    expect(await sender.send("t", { title: "a", body: "b" })).toMatchObject({ ok: false, error: "FCM not configured" });
  });
});

describe("PushService", () => {
  it("persists tokens, sends to every device and drops unregistered ones", async () => {
    const file = join(dir, "push.json");
    const { fn } = fakeFetch((c) => {
      if (c.url.includes("oauth2")) return oauthOk();
      const token = JSON.parse(String(c.init?.body)).message.token;
      return token === "dead" ? new Response("UNREGISTERED", { status: 404 }) : new Response("{}", { status: 200 });
    });
    const service = new PushService(new PushStore(file), new FcmSender({ serviceAccountJson: account, fetchImpl: fn }));
    await service.register("phone-a", "good");
    await service.register("phone-b", "dead");

    const result = await service.notify({ title: "t", body: "b" });
    expect(result).toMatchObject({ configured: true, devices: 2, sent: 1, failed: 1, removed: 1 });
    expect(service.deviceCount()).toBe(1);

    const reloaded = new PushStore(file);
    await reloaded.load();
    expect(reloaded.list().map((d) => d.deviceId)).toEqual(["phone-a"]);
  });

  it("does not try to send when FCM is not configured", async () => {
    const service = new PushService(new PushStore(join(dir, "p.json")), new FcmSender({}));
    await service.register("phone-a", "tok");
    expect(await service.notify({ title: "t", body: "b" })).toMatchObject({ configured: false, sent: 0, devices: 1 });
  });
});
