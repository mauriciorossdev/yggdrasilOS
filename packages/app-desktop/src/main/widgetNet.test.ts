import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWidgetCache, guardedFetch, type NetRequest } from "./widgetNet.js";

let dir: string;
let caches: ReturnType<typeof createWidgetCache>[] = [];
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ygg-widget-"));
});
afterEach(async () => {
  // Writes are fire-and-forget: let them land before removing the folder.
  await Promise.all(caches.map((c) => c.flush()));
  caches = [];
  await rm(dir, { recursive: true, force: true });
});

const req: NetRequest = { url: "https://api.example.com/x", allowed: ["api.example.com"] };

function setup(status = 200) {
  let calls = 0;
  let time = 1_000_000;
  const fetcher = async () => ({ status, ok: status === 200, body: `answer ${++calls}` });
  const make = () => {
    const cache = createWidgetCache(join(dir, "cache.json"), fetcher, () => time);
    caches.push(cache);
    return cache;
  };
  return { make, cache: make(), calls: () => calls, advance: (seconds: number) => (time += seconds * 1000) };
}

describe("widget cache", () => {
  it("reuses the answer inside the interval, also after a restart", async () => {
    const s = setup();
    await s.cache.fetch("a", 900, req);
    expect((await s.cache.fetch("a", 900, req)).cached).toBe(true);
    await s.cache.flush();
    expect((await s.make().fetch("a", 900, req)).body).toBe("answer 1");
    expect(s.calls()).toBe(1);
    s.advance(900);
    expect((await s.cache.fetch("a", 900, req)).body).toBe("answer 2");
  });

  it("with manual refresh keeps the answer until invalidated", async () => {
    const s = setup();
    await s.cache.fetch("a", 0, req);
    s.advance(999_999);
    expect((await s.cache.fetch("a", 0, req)).cached).toBe(true);
    await s.cache.invalidate("a");
    expect((await s.cache.fetch("a", 0, req)).cached).toBe(false);
  });

  it("separates instances and keys, shares concurrent requests, skips errors", async () => {
    const s = setup();
    await Promise.all([s.cache.fetch("a", 900, req), s.cache.fetch("a", 900, req)]);
    expect(s.calls()).toBe(1);
    await s.cache.fetch("b", 900, req);
    await s.cache.fetch("a", 900, { ...req, secret: { header: "X-Key", value: "other", domain: "api.example.com" } });
    expect(s.calls()).toBe(3);

    const failing = setup(401);
    await failing.cache.fetch("z", 900, req);
    await failing.cache.fetch("z", 900, req);
    expect(failing.calls()).toBe(2);
  });

  it("does not answer from cache once the grant is gone", async () => {
    const s = setup();
    await s.cache.fetch("a", 900, req);
    await expect(s.cache.fetch("a", 900, { ...req, allowed: [] })).rejects.toThrow(/not-granted/);
  });

  it("moves a preview's answers to the saved instance", async () => {
    const s = setup();
    await s.cache.fetch("draft:a", 900, req);
    await s.cache.adopt("draft:a", "a");
    expect((await s.cache.fetch("a", 900, req)).cached).toBe(true);
  });
});

describe("guardedFetch", () => {
  it("refuses a secret outside its domain before touching the network", async () => {
    const secret = { header: "X-Key", value: "k", domain: "api.example.com" };
    await expect(guardedFetch({ url: "https://other.example.com/", allowed: ["other.example.com"], secret })).rejects.toThrow(/not-granted/);
  });

  it("refuses an allowed name that resolves to this machine", async () => {
    await expect(guardedFetch({ url: "https://localhost/", allowed: ["localhost"] })).rejects.toThrow(/blocked-address/);
  });
});
