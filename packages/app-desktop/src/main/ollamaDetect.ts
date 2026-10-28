import { findOnPath } from "./ideSettings.js";

export const OLLAMA_URL = "http://127.0.0.1:11434";

export type OllamaStatus = {
  /** The `ollama` binary is on PATH, or its server answered — either way it's there. */
  installed: boolean;
  /** The local server answered on 127.0.0.1:11434. */
  running: boolean;
  /** Names of locally pulled models (empty when not running). */
  models: string[];
};

/** Model names out of an `/api/tags` response; tolerant of anything unexpected. */
export function parseOllamaTags(json: unknown): string[] {
  const models = (json as { models?: unknown })?.models;
  if (!Array.isArray(models)) return [];
  return models
    .map((m) => (m as { name?: unknown })?.name)
    .filter((name): name is string => typeof name === "string" && name.length > 0);
}

export type OllamaDetectDeps = {
  locate: (command: string) => Promise<string | null>;
  fetchTags: () => Promise<unknown>;
};

const defaultDeps: OllamaDetectDeps = {
  locate: findOnPath,
  fetchTags: async () => {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) throw new Error(`ollama /api/tags ${res.status}`);
    return res.json();
  },
};

export async function detectOllama(deps: OllamaDetectDeps = defaultDeps): Promise<OllamaStatus> {
  const [binary, tags] = await Promise.all([
    deps.locate("ollama"),
    deps.fetchTags().then(
      (json) => ({ ok: true as const, json }),
      () => ({ ok: false as const }),
    ),
  ]);
  const running = tags.ok;
  return {
    installed: Boolean(binary) || running,
    running,
    models: tags.ok ? parseOllamaTags(tags.json) : [],
  };
}
