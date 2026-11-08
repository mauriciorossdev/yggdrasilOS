import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeAll, afterAll, describe, expect, it } from "vitest";
import { chatComplete, chatCompleteStream } from "../../../packages/provider-ollama/src/client.js";
import { parseFaults, seededRandom, startFaultProxy, type FaultProxy } from "./faultProxy.js";

// A stand-in Ollama: answers every chat with a streamed or whole reply, and records what reached it.
let upstream: Server;
let upstreamUrl = "";
const reached: Array<{ url: string; auth?: string }> = [];

beforeAll(async () => {
  upstream = createServer((req, res) => {
    reached.push({ url: req.url ?? "", auth: req.headers.authorization });
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url === "/api/tags") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ models: [{ name: "m" }] }));
        return;
      }
      const reply = (content: string, done: boolean) => JSON.stringify({ model: "m", message: { role: "assistant", content }, done });
      const wantsStream = (() => {
        try {
          return JSON.parse(body).stream === true;
        } catch {
          return false;
        }
      })();
      if (!wantsStream) {
        res.setHeader("content-type", "application/json");
        res.end(reply("hello", true));
        return;
      }
      res.setHeader("content-type", "application/x-ndjson");
      res.write(reply("hel", false) + "\n");
      setTimeout(() => res.end(reply("lo", true) + "\n"), 10);
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => upstream.close(() => resolve())));

let proxy: FaultProxy | undefined;
afterEach(async () => {
  await proxy?.close();
  proxy = undefined;
  reached.length = 0;
});

const params = { model: "m", messages: [{ role: "user" as const, content: "hi" }] };
const fast = { baseDelayMs: 1, maxDelayMs: 5 };

describe("parseFaults / seededRandom", () => {
  it("accepts statuses and reset, rejects anything else", () => {
    expect(parseFaults("500, 429,reset")).toEqual([500, 429, "reset"]);
    expect(parseFaults(undefined)).toBeUndefined();
    expect(() => parseFaults("200")).toThrow(/not an HTTP error/);
    expect(() => parseFaults("boom")).toThrow();
  });

  it("repeats the same sequence for the same seed", () => {
    const a = seededRandom(7);
    const b = seededRandom(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(seededRandom(8)()).not.toBe(seededRandom(7)());
  });
});

describe("fault proxy", () => {
  it("forwards untouched when the rate is 0, including headers and a streamed body", async () => {
    proxy = await startFaultProxy({ upstream: upstreamUrl, rate: 0 });
    const events: string[] = [];
    const result = await chatCompleteStream({ baseUrl: proxy.url, apiKey: "k" }, params, (e) => e.type === "delta" && events.push(e.text));
    expect(result.text).toBe("hello");
    expect(events).toEqual(["hel", "lo"]);
    expect(reached.at(-1)?.auth).toBe("Bearer k");
    expect(proxy.stats()).toMatchObject({ chatRequests: 1, injected: 0 });
  });

  it("never faults anything but chat requests", async () => {
    proxy = await startFaultProxy({ upstream: upstreamUrl, rate: 1 });
    const res = await fetch(`${proxy.url}/api/tags`);
    expect(res.status).toBe(200);
    expect(proxy.stats().injected).toBe(0);
  });

  it("injects the listed faults in order, without reaching the upstream", async () => {
    proxy = await startFaultProxy({ upstream: upstreamUrl, rate: 1, faults: [500, 503], maxConsecutive: 10 });
    const post = () => fetch(`${proxy!.url}/api/chat`, { method: "POST", body: "{}" });
    expect((await post()).status).toBe(500);
    expect((await post()).status).toBe(503);
    expect((await post()).status).toBe(500);
    expect(reached.filter((r) => r.url === "/api/chat")).toHaveLength(0);
    expect(proxy.stats()).toMatchObject({ chatRequests: 3, injected: 3 });
  });

  it("sends Retry-After with an injected 429", async () => {
    proxy = await startFaultProxy({ upstream: upstreamUrl, rate: 1, faults: [429] });
    const res = await fetch(`${proxy.url}/api/chat`, { method: "POST", body: "{}" });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("1");
  });

  it("does not fault more than maxConsecutive requests in a row", async () => {
    proxy = await startFaultProxy({ upstream: upstreamUrl, rate: 1, faults: [500], maxConsecutive: 2 });
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await fetch(`${proxy.url}/api/chat`, { method: "POST", body: "{}" })).status);
    expect(statuses).toEqual([500, 500, 200, 500, 500, 200]);
  });
});

describe("the provider's retries against injected faults", () => {
  it("recovers from every kind of fault, including a dropped connection", async () => {
    proxy = await startFaultProxy({ upstream: upstreamUrl, rate: 1, faults: [500, "reset", 429, 503, 502], maxConsecutive: 5 });
    const seen: string[] = [];
    // 429 carries Retry-After: 1 (a real second), so keep the whole run to one of those.
    const result = await chatComplete({ baseUrl: proxy.url, retry: { ...fast, onRetry: (i) => seen.push(i.reason) } }, params);
    expect(result.text).toBe("hello");
    expect(seen.length).toBe(5);
    expect(seen[0]).toBe("HTTP 500");
    expect(seen.some((r) => r === "HTTP 429")).toBe(true);
    expect(proxy.stats().injected).toBe(5);
  }, 20_000);

  it("fails with the injected status when retries are off", async () => {
    proxy = await startFaultProxy({ upstream: upstreamUrl, rate: 1, faults: [500] });
    await expect(chatComplete({ baseUrl: proxy.url, retry: { maxRetries: 0 } }, params)).rejects.toThrow(/HTTP 500/);
  });
});
