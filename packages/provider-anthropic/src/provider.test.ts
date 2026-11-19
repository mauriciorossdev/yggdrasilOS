import { afterEach, describe, it, expect, vi } from "vitest";
import { DEFAULT_ANTHROPIC_MODEL, createAnthropicProvider, fetchAnthropicModels, resolveAnthropicConfig } from "./provider.js";
import type { YggdrasilConfig } from "@yggdrasil/config";

describe("resolveAnthropicConfig", () => {
  it("reads defaultModel from providers.anthropic", () => {
    const config: YggdrasilConfig = {
      providers: { anthropic: { defaultModel: "claude-sonnet-5-5" } },
    };
    expect(resolveAnthropicConfig(config).defaultModel).toBe("claude-sonnet-5-5");
  });
});

describe("createAnthropicProvider", () => {
  it("lists Haiku 4.5 by default", async () => {
    const provider = createAnthropicProvider();
    const models = await provider.listModels({ config: {} });
    expect(models[0]!.id).toBe(DEFAULT_ANTHROPIC_MODEL);
    expect(DEFAULT_ANTHROPIC_MODEL).toBe("claude-haiku-4-5-20251001");
  });

  it("includes a configured custom default model first", async () => {
    const provider = createAnthropicProvider();
    const models = await provider.listModels({ config: { defaultModel: "claude-custom" } });
    expect(models[0]!.id).toBe("claude-custom");
  });

  afterEach(() => vi.unstubAllGlobals());

  it("falls back to the static list when the live /v1/models call fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const provider = createAnthropicProvider();
    const models = await provider.listModels({ config: { apiKey: "k" } });
    expect(models[0]!.id).toBe(DEFAULT_ANTHROPIC_MODEL);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    expect((await provider.listModels({ config: { apiKey: "k" } }))[0]!.id).toBe(DEFAULT_ANTHROPIC_MODEL);
  });
});

describe("fetchAnthropicModels", () => {
  it("maps /v1/models into provider models", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ data: [{ id: "claude-x", display_name: "Claude X" }] }), { status: 200 })) as typeof fetch;
    const models = await fetchAnthropicModels({ baseUrl: "https://api.anthropic.com/", apiKey: "k", fetchImpl });
    expect(models).toEqual([expect.objectContaining({ id: "claude-x", label: "Claude X", provider: "anthropic" })]);
  });

  it("throws a readable error when the key is rejected", async () => {
    const fetchImpl = (async () => new Response("{}", { status: 401 })) as typeof fetch;
    await expect(fetchAnthropicModels({ baseUrl: "https://api.anthropic.com", apiKey: "bad", fetchImpl })).rejects.toThrow(/rechaz/);
  });
});
