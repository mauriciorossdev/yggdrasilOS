import { describe, expect, it } from "vitest";
import { chatComplete, chatCompleteStream } from "./client.js";

const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const reply = { model: "m", message: { role: "assistant", content: "hola" }, done: true };

function capture() {
  const seen: { body?: Record<string, unknown>; init?: RequestInit } = {};
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    seen.init = init;
    seen.body = JSON.parse(String(init?.body));
    return jsonResponse(reply);
  }) as typeof fetch;
  return { seen, fetchImpl };
}

describe("chatComplete think option", () => {
  it("leaves `think` out unless configured, so the model's own default applies", async () => {
    const { seen, fetchImpl } = capture();
    await chatComplete({ baseUrl: "http://x", fetchImpl }, { model: "m", messages: [{ role: "user", content: "hi" }] });
    expect(seen.body).not.toHaveProperty("think");
  });

  it("sends think:false when thinking is turned off", async () => {
    const { seen, fetchImpl } = capture();
    await chatComplete({ baseUrl: "http://x", fetchImpl, think: false }, { model: "m", messages: [{ role: "user", content: "hi" }] });
    expect(seen.body?.think).toBe(false);
  });

  it("sends think:true as well", async () => {
    const { seen, fetchImpl } = capture();
    await chatComplete({ baseUrl: "http://x", fetchImpl, think: true }, { model: "m", messages: [{ role: "user", content: "hi" }] });
    expect(seen.body?.think).toBe(true);
  });
});

describe("cancellation", () => {
  it("hands the turn's AbortSignal to fetch (non-streaming)", async () => {
    const { seen, fetchImpl } = capture();
    const controller = new AbortController();
    await chatComplete({ baseUrl: "http://x", fetchImpl }, { model: "m", messages: [{ role: "user", content: "hi" }], signal: controller.signal });
    expect(seen.init?.signal).toBe(controller.signal);
  });

  it("hands it to fetch when streaming too, and think applies there", async () => {
    const seen: { init?: RequestInit; body?: Record<string, unknown> } = {};
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      seen.init = init;
      seen.body = JSON.parse(String(init?.body));
      const line = JSON.stringify({ model: "m", message: { role: "assistant", content: "ok" }, done: true });
      return new Response(`${line}\n`, { status: 200 });
    }) as typeof fetch;
    const controller = new AbortController();
    await chatCompleteStream({ baseUrl: "http://x", fetchImpl, think: false }, { model: "m", messages: [{ role: "user", content: "hi" }], signal: controller.signal }, () => {});
    expect(seen.init?.signal).toBe(controller.signal);
    expect(seen.body?.think).toBe(false);
  });
});
