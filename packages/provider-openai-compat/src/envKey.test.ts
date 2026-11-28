import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAICompatProvider } from "./provider.js";

const keyFor = (config: { baseUrl?: string; apiKey?: string }) => createOpenAICompatProvider().resolveApiKey!({ config });

describe("API key taken from the environment", () => {
  const setEnv = (env: { ollama?: string; openai?: string; yggdrasil?: string }) => {
    vi.stubEnv("OLLAMA_API_KEY", env.ollama ?? "");
    vi.stubEnv("OPENAI_API_KEY", env.openai ?? "");
    vi.stubEnv("YGGDRASIL_OPENAI_API_KEY", env.yggdrasil ?? "");
  };
  afterEach(() => vi.unstubAllEnvs());

  it("never sends the Ollama key to OpenAI", async () => {
    setEnv({ ollama: "ollama-key" });
    expect(await keyFor({})).toBeUndefined();
    expect(await keyFor({ baseUrl: "https://api.openai.com/v1" })).toBeUndefined();
  });

  it("gives each service only its own key", async () => {
    setEnv({ ollama: "ollama-key", openai: "openai-key" });
    expect(await keyFor({})).toBe("openai-key");
    expect(await keyFor({ baseUrl: "https://ollama.com/v1" })).toBe("ollama-key");
    setEnv({ openai: "openai-key" });
    expect(await keyFor({ baseUrl: "https://ollama.com/v1" })).toBeUndefined();
  });

  it("sends neither to a third party, to lookalike hosts or over plain http", async () => {
    setEnv({ ollama: "ollama-key", openai: "openai-key" });
    for (const baseUrl of [
      "https://openrouter.ai/api/v1",
      "https://api.openai.com.example.net/v1",
      "https://notollama.com/v1",
      "http://api.openai.com/v1",
      "http://192.168.1.20:11434/v1",
      "not a url",
    ]) {
      expect(await keyFor({ baseUrl }), baseUrl).toBeUndefined();
    }
  });

  it("keeps working for a server on this machine, where the key does not leave it", async () => {
    setEnv({ ollama: "ollama-key" });
    for (const baseUrl of ["http://localhost:11434/v1", "http://127.0.0.1:11434/v1", "http://[::1]:4000/v1"]) {
      expect(await keyFor({ baseUrl }), baseUrl).toBe("ollama-key");
    }
  });

  it("uses the app's own variable for any endpoint, and a configured key above all", async () => {
    setEnv({ ollama: "ollama-key", yggdrasil: "own-key" });
    expect(await keyFor({ baseUrl: "https://openrouter.ai/api/v1" })).toBe("own-key");
    expect(await keyFor({})).toBe("own-key");
    expect(await keyFor({ baseUrl: "https://openrouter.ai/api/v1", apiKey: "typed" })).toBe("typed");
  });
});
