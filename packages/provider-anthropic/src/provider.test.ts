import { describe, it, expect } from "vitest";
import { DEFAULT_ANTHROPIC_MODEL, createAnthropicProvider, resolveAnthropicConfig } from "./provider.js";
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
});
