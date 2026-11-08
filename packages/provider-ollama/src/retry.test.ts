import { describe, expect, it } from "vitest";
import { backoffDelay, isRetryableNetworkError, isRetryableStatus, parseRetryAfter, sendWithRetry } from "./retry.js";
import { chatComplete, chatCompleteStream } from "./client.js";

const res = (status: number, body = "", headers: Record<string, string> = {}) => new Response(body, { status, headers });
const ok = () => new Response(JSON.stringify({ model: "m", message: { role: "assistant", content: "hi" }, done: true }), { status: 200 });
const params = { model: "m", messages: [{ role: "user" as const, content: "hi" }] };

/** Plays back responses/errors in order and records the waits instead of sleeping. */
function script(steps: Array<Response | Error>) {
  let i = 0;
  const waits: number[] = [];
  const send = async () => {
    const step = steps[Math.min(i++, steps.length - 1)]!;
    if (step instanceof Error) throw step;
    return step;
  };
  return { send, waits, calls: () => i, retry: { sleep: async (ms: number) => void waits.push(ms), random: () => 0.5, baseDelayMs: 100, maxDelayMs: 1000 } };
}

describe("classification", () => {
  it("retries rate limits and server errors, not client errors", () => {
    for (const s of [408, 429, 500, 502, 503, 504, 529]) expect(isRetryableStatus(s), String(s)).toBe(true);
    for (const s of [200, 400, 401, 403, 404, 422]) expect(isRetryableStatus(s), String(s)).toBe(false);
  });

  it("retries dropped connections but not 'nothing is listening'", () => {
    const withCode = (code: string) => Object.assign(new Error("x"), { code });
    expect(isRetryableNetworkError(withCode("ECONNRESET"))).toBe(true);
    expect(isRetryableNetworkError(withCode("ETIMEDOUT"))).toBe(true);
    expect(isRetryableNetworkError(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }))).toBe(true);
    expect(isRetryableNetworkError(new TypeError("fetch failed"))).toBe(true);
    expect(isRetryableNetworkError(withCode("ECONNREFUSED"))).toBe(false);
    expect(isRetryableNetworkError(withCode("ENOTFOUND"))).toBe(false);
    expect(isRetryableNetworkError(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(false);
    expect(isRetryableNetworkError("string")).toBe(false);
  });
});

describe("delays", () => {
  it("parses Retry-After as seconds or as a date, and caps a huge ask", () => {
    expect(parseRetryAfter("3")).toBe(3000);
    expect(parseRetryAfter("0")).toBe(0);
    expect(parseRetryAfter("100000")).toBe(60_000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(parseRetryAfter("garbage")).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });

  it("doubles up to the cap, with ±25% jitter", () => {
    const mid = { baseDelayMs: 1000, maxDelayMs: 8000, random: () => 0.5 };
    expect([1, 2, 3, 4, 5, 9].map((a) => backoffDelay(a, mid))).toEqual([1000, 2000, 4000, 8000, 8000, 8000]);
    expect(backoffDelay(1, { ...mid, random: () => 0 })).toBe(750);
    expect(backoffDelay(1, { ...mid, random: () => 1 })).toBe(1250);
  });

  it("a longer Retry-After wins, a shorter one does not", () => {
    const o = { baseDelayMs: 1000, random: () => 0.5 };
    expect(backoffDelay(1, o, 5000)).toBe(5000);
    expect(backoffDelay(1, o, 200)).toBe(1000);
  });
});

describe("sendWithRetry", () => {
  it("returns a good response straight away", async () => {
    const s = script([ok()]);
    expect((await sendWithRetry(s.send, s.retry)).status).toBe(200);
    expect(s.calls()).toBe(1);
    expect(s.waits).toEqual([]);
  });

  it("retries 500s with growing waits, then succeeds", async () => {
    const s = script([res(500), res(503), ok()]);
    expect((await sendWithRetry(s.send, s.retry)).status).toBe(200);
    expect(s.calls()).toBe(3);
    expect(s.waits).toEqual([100, 200]);
  });

  it("honors Retry-After on a 429", async () => {
    const s = script([res(429, "", { "retry-after": "2" }), ok()]);
    await sendWithRetry(s.send, s.retry);
    expect(s.waits).toEqual([2000]);
  });

  it("does not retry a client error", async () => {
    const s = script([res(401), ok()]);
    expect((await sendWithRetry(s.send, s.retry)).status).toBe(401);
    expect(s.calls()).toBe(1);
  });

  it("gives back the last response once the retries run out", async () => {
    const s = script([res(500), res(500), res(502)]);
    const response = await sendWithRetry(s.send, { ...s.retry, maxRetries: 2 });
    expect(response.status).toBe(502);
    expect(s.calls()).toBe(3);
  });

  it("maxRetries 0 means a single attempt", async () => {
    const s = script([res(500), ok()]);
    expect((await sendWithRetry(s.send, { ...s.retry, maxRetries: 0 })).status).toBe(500);
    expect(s.calls()).toBe(1);
  });

  it("retries a dropped connection and throws the last error when it keeps failing", async () => {
    const drop = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    const recovers = script([drop, ok()]);
    expect((await sendWithRetry(recovers.send, recovers.retry)).status).toBe(200);

    const stuck = script([drop]);
    await expect(sendWithRetry(stuck.send, { ...stuck.retry, maxRetries: 2 })).rejects.toThrow("socket hang up");
    expect(stuck.calls()).toBe(3);
  });

  it("fails fast when nothing is listening", async () => {
    const refused = script([Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" })]);
    await expect(sendWithRetry(refused.send, refused.retry)).rejects.toThrow(/ECONNREFUSED/);
    expect(refused.calls()).toBe(1);
  });

  it("a cancelled turn does not sit out the wait", async () => {
    const controller = new AbortController();
    const s = script([res(500), ok()]);
    const started = Date.now();
    const pending = sendWithRetry(s.send, { baseDelayMs: 30_000, random: () => 0.5 }, controller.signal);
    setTimeout(() => controller.abort(), 20);
    await expect(pending).rejects.toBeDefined();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("reports each retry", async () => {
    const seen: Array<{ attempt: number; reason: string }> = [];
    const s = script([res(500), res(429), ok()]);
    await sendWithRetry(s.send, { ...s.retry, onRetry: (i) => seen.push({ attempt: i.attempt, reason: i.reason }) });
    expect(seen).toEqual([{ attempt: 1, reason: "HTTP 500" }, { attempt: 2, reason: "HTTP 429" }]);
  });
});

describe("through the chat client", () => {
  it("chatComplete survives a 500 and returns the reply", async () => {
    const s = script([res(500, "Internal Server Error"), ok()]);
    const fetchImpl = (async () => s.send()) as typeof fetch;
    const result = await chatComplete({ baseUrl: "http://x", fetchImpl, retry: s.retry }, params);
    expect(result.text).toBe("hi");
    expect(s.calls()).toBe(2);
  });

  it("streaming retries before the stream starts", async () => {
    const line = JSON.stringify({ model: "m", message: { role: "assistant", content: "ok" }, done: true });
    const s = script([res(503), new Response(`${line}\n`, { status: 200 })]);
    const fetchImpl = (async () => s.send()) as typeof fetch;
    const deltas: string[] = [];
    const result = await chatCompleteStream({ baseUrl: "http://x", fetchImpl, retry: s.retry }, params, (e) => e.type === "delta" && deltas.push(e.text));
    expect(result.text).toBe("ok");
    expect(deltas).toEqual(["ok"]);
    expect(s.calls()).toBe(2);
  });

  it("surfaces the final status when every attempt fails, with the 401 hint untouched", async () => {
    let calls = 0;
    // A fresh Response per attempt, like a real server (a Response body can only be read once).
    const failing = (async () => {
      calls++;
      return res(500, "boom");
    }) as typeof fetch;
    await expect(chatComplete({ baseUrl: "http://x", fetchImpl: failing, retry: { ...script([ok()]).retry, maxRetries: 1 } }, params)).rejects.toThrow(/HTTP 500.*boom/);
    expect(calls).toBe(2);

    const denied = script([res(401)]);
    await expect(chatComplete({ baseUrl: "http://x", fetchImpl: (async () => denied.send()) as typeof fetch, retry: denied.retry }, params)).rejects.toThrow(/API key/);
    expect(denied.calls()).toBe(1);
  });

  it("reports each retry to the caller through params.onRetry", async () => {
    const s = script([res(500), res(429), ok()]);
    const fetchImpl = (async () => s.send()) as typeof fetch;
    const seen: Array<{ attempt: number; reason: string }> = [];
    await chatComplete({ baseUrl: "http://x", fetchImpl, retry: s.retry }, { ...params, onRetry: (i) => seen.push({ attempt: i.attempt, reason: i.reason }) });
    expect(seen).toEqual([{ attempt: 1, reason: "HTTP 500" }, { attempt: 2, reason: "HTTP 429" }]);
  });
});
