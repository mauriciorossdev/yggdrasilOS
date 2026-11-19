import type { ConfigShape } from "../types.js";

/**
 * The providers part of Settings' save: what the form holds, plus API keys only where the user typed
 * one. config.get never returns real keys (it shows a mask), so any `apiKey` in `config.providers` is
 * that mask and must not be sent back, or it would replace the stored key.
 */
export function buildProvidersPatch(
  config: ConfigShape,
  apiKeyEdits: Record<string, string>,
): ConfigShape["providers"] {
  const providers: NonNullable<ConfigShape["providers"]> = {};
  for (const [id, entry] of Object.entries(config.providers ?? {})) {
    const { apiKey: _mask, ...rest } = entry;
    providers[id] = rest;
  }
  for (const [id, key] of Object.entries(apiKeyEdits)) {
    if (!key) continue;
    providers[id] = { ...providers[id], apiKey: key };
  }
  return providers;
}
