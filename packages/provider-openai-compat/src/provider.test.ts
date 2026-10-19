import { describe, it, expect } from "vitest";
import { resolveOpenAICompatConfig } from "./provider.js";
import type { YggdrasilConfig } from "@yggdrasil/config";

describe("resolveOpenAICompatConfig", () => {
  it("reads baseUrl from providers.openai-compat", () => {
    const config: YggdrasilConfig = {
      providers: {
        "openai-compat": {
          baseUrl: "https://ollama.com/v1",
          defaultModel: "gpt-oss:120b",
        },
      },
    };
    const cfg = resolveOpenAICompatConfig(config);
    expect(cfg.baseUrl).toBe("https://ollama.com/v1");
    expect(cfg.defaultModel).toBe("gpt-oss:120b");
  });

  it("pluginConfig overrides providers", () => {
    const config: YggdrasilConfig = {
      providers: { "openai-compat": { baseUrl: "https://api.openai.com/v1" } },
      pluginConfig: {
        "openai-compat": { baseUrl: "http://localhost:11434/v1" },
      },
    };
    const cfg = resolveOpenAICompatConfig(config);
    expect(cfg.baseUrl).toBe("http://localhost:11434/v1");
  });
});
