import { describe, expect, it } from "vitest";
import { chatComplete, chatCompleteStream, listModels } from "./client.js";
import { apiKeyOf } from "./provider.js";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const chatBody = { model: "m", message: { role: "assistant", content: "hi" }, done: true };
const params = { model: "m", messages: [{ role: "user" as const, content: "hi" }] };

function recorder(response: () => Response) {
  const seen: Array<Record<string, string>> = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    seen.push((init?.headers as Record<string, string>) ?? {});
    return response();
  }) as typeof fetch;
  return { seen, fetchImpl };
}

describe("Authorization header", () => {
  it("is sent on chat, streaming and model listing when an API key is set", async () => {
    const chat = recorder(() => ok(chatBody));
    await chatComplete({ baseUrl: "http://x", fetchImpl: chat.fetchImpl, apiKey: "secret" }, params);
    expect(chat.seen[0]?.Authorization).toBe("Bearer secret");

    const stream = recorder(() => new Response(`${JSON.stringify(chatBody)}\n`, { status: 200 }));
    await chatCompleteStream({ baseUrl: "http://x", fetchImpl: stream.fetchImpl, apiKey: "secret" }, params, () => {});
    expect(stream.seen[0]?.Authorization).toBe("Bearer secret");

    const tags = recorder(() => ok({ models: [] }));
    await listModels({ baseUrl: "http://x", fetchImpl: tags.fetchImpl, apiKey: "secret" });
    expect(tags.seen[0]?.Authorization).toBe("Bearer secret");
  });

  it("is absent without a key, so a local server sees exactly what it did before", async () => {
    const chat = recorder(() => ok(chatBody));
    await chatComplete({ baseUrl: "http://x", fetchImpl: chat.fetchImpl }, params);
    expect(chat.seen[0]).not.toHaveProperty("Authorization");
  });
});

describe("rejected credentials", () => {
  it("explains a 401 without echoing the key", async () => {
    const denied = recorder(() => new Response("unauthorized", { status: 401 }));
    const withKey = chatComplete({ baseUrl: "http://x", fetchImpl: denied.fetchImpl, apiKey: "secret-key-123" }, params);
    await expect(withKey).rejects.toThrow(/rejected the API key/);
    await expect(withKey).rejects.not.toThrow(/secret-key-123/);

    const withoutKey = chatComplete({ baseUrl: "http://x", fetchImpl: denied.fetchImpl }, params);
    await expect(withoutKey).rejects.toThrow(/OLLAMA_API_KEY/);
  });

  it("hints on listModels too, and leaves other statuses alone", async () => {
    await expect(listModels({ baseUrl: "http://x", fetchImpl: recorder(() => new Response("", { status: 403 })).fetchImpl })).rejects.toThrow(/wants an API key/);
    await expect(listModels({ baseUrl: "http://x", fetchImpl: recorder(() => new Response("", { status: 500 })).fetchImpl })).rejects.toThrow(/HTTP 500$/);
  });
});

describe("apiKeyOf", () => {
  it("prefers the config, falls back to the environment, ignores blanks", () => {
    expect(apiKeyOf({ apiKey: "from-config" }, { OLLAMA_API_KEY: "from-env" })).toBe("from-config");
    expect(apiKeyOf({}, { OLLAMA_API_KEY: "from-env" })).toBe("from-env");
    expect(apiKeyOf({ apiKey: "  " }, { OLLAMA_API_KEY: " " })).toBeUndefined();
    expect(apiKeyOf({}, {})).toBeUndefined();
  });
});
