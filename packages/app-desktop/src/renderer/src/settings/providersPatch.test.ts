import { describe, expect, it } from "vitest";
import { buildProvidersPatch } from "./providersPatch.js";

describe("buildProvidersPatch", () => {
  it("never sends the masked key config.get returned", () => {
    const patch = buildProvidersPatch({ providers: { anthropic: { apiKey: "***", defaultModel: "m" } } }, {});
    expect(patch!.anthropic).toEqual({ defaultModel: "m" });
  });
  it("sends a key only where the user typed one", () => {
    const patch = buildProvidersPatch(
      { providers: { anthropic: { apiKey: "***" }, ollama: { baseUrl: "http://h" } } },
      { anthropic: "sk-ant-new", openai: "" },
    );
    expect(patch!.anthropic).toEqual({ apiKey: "sk-ant-new" });
    expect(patch!.ollama).toEqual({ baseUrl: "http://h" });
    expect(patch).not.toHaveProperty("openai");
  });
});
