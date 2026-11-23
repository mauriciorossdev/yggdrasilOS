import type { ConfigShape } from "../types.js";

type ProviderEdits = Record<string, { baseUrl?: string; apiKey?: string; defaultModel?: string }>;

/**
 * The providers part of Settings' save: only the fields the user actually changed since the
 * form loaded (an emptied field is sent as "" = remove), plus API keys where the user typed
 * one. Since providers save to the global file shared by every project and the TUI
 * (notes/features/global-providers.md), sending the whole form would copy values that only
 * came from the defaults or from this project into it. `config.get` never returns real keys
 * (it shows a mask), so `apiKey` is only ever taken from `apiKeyEdits`.
 */
export function buildProvidersPatch(
  config: ConfigShape,
  loaded: ConfigShape["providers"],
  apiKeyEdits: Record<string, string>,
): ProviderEdits {
  const edits: ProviderEdits = {};
  for (const [id, entry] of Object.entries(config.providers ?? {})) {
    for (const field of ["baseUrl", "defaultModel"] as const) {
      const now = entry[field] ?? "";
      if (now !== (loaded?.[id]?.[field] ?? "")) edits[id] = { ...edits[id], [field]: now };
    }
  }
  for (const [id, key] of Object.entries(apiKeyEdits)) {
    if (key) edits[id] = { ...edits[id], apiKey: key };
  }
  return edits;
}

/** Splits edits by where each provider saves: global (default) or only this project. */
export function splitProvidersPatch(
  edits: ProviderEdits,
  projectOnly: Record<string, boolean>,
): { global: ProviderEdits; project: ProviderEdits } {
  const global: ProviderEdits = {};
  const project: ProviderEdits = {};
  for (const [id, edit] of Object.entries(edits)) (projectOnly[id] ? project : global)[id] = edit;
  return { global, project };
}
