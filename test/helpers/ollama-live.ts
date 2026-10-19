import { DEFAULT_CONFIG, mergeConfig, type YggdrasilConfig } from "@yggdrasil/config";

export const OLLAMA_CLOUD_BASE_URL = "https://ollama.com/v1";
export const DEFAULT_LIVE_MODEL = "gemma4:31b-cloud";

export function hasOllamaLive(): boolean {
  return Boolean(process.env.OLLAMA_API_KEY?.trim());
}

export function resolveLiveModel(): string {
  return process.env.YGGDRASIL_TEST_MODEL?.trim() || DEFAULT_LIVE_MODEL;
}

export function createOllamaLiveConfig(
  sessionDir: string,
  gatewayPort: number,
  httpPort?: number,
  overrides?: Partial<YggdrasilConfig>,
): YggdrasilConfig {
  const model = resolveLiveModel();
  return mergeConfig(DEFAULT_CONFIG, {
    gateway: { port: gatewayPort, host: "127.0.0.1" },
    sessions: { dir: sessionDir },
    agents: [{ id: "default", provider: "openai-compat", model }],
    providers: {
      "openai-compat": {
        baseUrl: OLLAMA_CLOUD_BASE_URL,
        defaultModel: model,
      },
    },
    harness: { streaming: true, maxToolIterations: 8, policy: "auto" },
    channels: {
      tui: { enabled: false },
      http: httpPort
        ? { enabled: true, accounts: { default: { port: httpPort, host: "127.0.0.1" } } }
        : { enabled: false },
      echo: { enabled: false },
    },
    plugins: { load: { paths: ["extensions"] } },
    ...overrides,
  });
}

import { describe } from "vitest";

export function liveDescribe(title: string, fn: () => void): void {
  (hasOllamaLive() ? describe : describe.skip)(title, fn);
}

export const LIVE_TEST_TIMEOUT_MS = 60_000;
