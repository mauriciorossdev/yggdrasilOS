import { describe, expect, it } from "vitest";
import { buildProvidersPatch, splitProvidersPatch } from "./providersPatch.js";

describe("buildProvidersPatch", () => {
  const loaded = { anthropic: { apiKey: "***", defaultModel: "m" }, ollama: { baseUrl: "http://lan:11434" } };

  it("sends nothing when nothing changed, and never the key mask", () => {
    expect(buildProvidersPatch({ providers: loaded }, loaded, {})).toEqual({});
  });

  it("sends only changed fields, with an emptied one as a removal", () => {
    const config = { providers: { anthropic: { apiKey: "***", defaultModel: "m2" }, ollama: { baseUrl: undefined } } };
    expect(buildProvidersPatch(config, loaded, {})).toEqual({ anthropic: { defaultModel: "m2" }, ollama: { baseUrl: "" } });
  });

  it("adds typed keys, skipping empty ones", () => {
    expect(buildProvidersPatch({ providers: loaded }, loaded, { anthropic: "sk-new", ollama: "" })).toEqual({
      anthropic: { apiKey: "sk-new" },
    });
  });
});

describe("splitProvidersPatch", () => {
  it("routes each provider to global unless it's marked project-only", () => {
    expect(splitProvidersPatch({ a: { baseUrl: "x" }, b: { apiKey: "k" } }, { b: true })).toEqual({
      global: { a: { baseUrl: "x" } },
      project: { b: { apiKey: "k" } },
    });
  });
});
