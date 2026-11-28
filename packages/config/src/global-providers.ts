import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ProviderConfig } from "./index.js";

/**
 * Providers shared by every project and by the TUI (notes/features/global-providers.md).
 * Precedence, field by field: built-in defaults < this file < what a project set on purpose.
 * An API key may live here in plain text, so the file is 0600 inside a 0700 folder.
 */

export type ProvidersMap = Record<string, ProviderConfig>;
export type ProviderField = keyof ProviderConfig;
export type ProviderFieldSource = "default" | "global" | "project" | "env";
export type ProviderSources = Record<string, Partial<Record<ProviderField, ProviderFieldSource>>>;

export const PROVIDER_FIELDS: readonly ProviderField[] = ["baseUrl", "apiKey", "defaultModel"];

export function resolveGlobalProvidersPath(): string {
  return join(homedir(), ".yggdrasil", "providers.json");
}

/** Drops unknown fields and empty strings; an entry left with nothing is dropped too. */
export function cleanProviders(raw: unknown): ProvidersMap {
  const out: ProvidersMap = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") continue;
    const clean: ProviderConfig = {};
    for (const field of PROVIDER_FIELDS) {
      const value = (entry as Record<string, unknown>)[field];
      if (typeof value === "string" && value.trim()) clean[field] = value.trim();
    }
    if (Object.keys(clean).length > 0) out[id] = clean;
  }
  return out;
}

export async function readGlobalProviders(): Promise<ProvidersMap> {
  try {
    const raw = JSON.parse(await readFile(resolveGlobalProvidersPath(), "utf8")) as { providers?: unknown };
    return cleanProviders(raw.providers);
  } catch {
    return {};
  }
}

/** Replaces the whole file. Written to a temp file and renamed so a reader never sees half of it. */
export async function writeGlobalProviders(providers: ProvidersMap): Promise<string> {
  const path = resolveGlobalProvidersPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify({ providers: cleanProviders(providers) }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, path);
  return path;
}

/**
 * Applies a per-field edit: a non-empty string sets the field, an empty string removes it,
 * an absent field is left alone. Pure, so the gateway can apply the same edit to the global
 * file or to a project's providers.
 */
export function applyProviderEdits(current: ProvidersMap, edits: Record<string, Partial<ProviderConfig>>): ProvidersMap {
  const next: ProvidersMap = {};
  for (const [id, entry] of Object.entries(current)) next[id] = { ...entry };
  for (const [id, edit] of Object.entries(edits)) {
    const entry: ProviderConfig = { ...next[id] };
    for (const field of PROVIDER_FIELDS) {
      const value = edit[field];
      if (value === undefined) continue;
      if (value.trim()) entry[field] = value.trim();
      else delete entry[field];
    }
    if (Object.keys(entry).length > 0) next[id] = entry;
    else delete next[id];
  }
  return next;
}

/** `current` without the given fields of each provider (the ones just saved globally). */
export function removeProviderFields(current: ProvidersMap, fields: Record<string, ProviderField[]>): ProvidersMap {
  const edits: Record<string, Partial<ProviderConfig>> = {};
  for (const [id, list] of Object.entries(fields)) {
    edits[id] = Object.fromEntries(list.map((f) => [f, ""]));
  }
  return applyProviderEdits(current, edits);
}

/**
 * What a project really set: its own providers minus any field equal to the built-in
 * default. Saving settings used to copy the defaults into every project's file (e.g.
 * openai-compat → api.openai.com / gpt-4o-mini); those copies must not hide the global value.
 */
export function projectOwnProviders(projectRaw: unknown, defaults: ProvidersMap): ProvidersMap {
  const own = cleanProviders(projectRaw);
  const out: ProvidersMap = {};
  for (const [id, entry] of Object.entries(own)) {
    const kept: ProviderConfig = {};
    for (const field of PROVIDER_FIELDS) {
      const value = entry[field];
      if (value !== undefined && value !== defaults[id]?.[field]) kept[field] = value;
    }
    if (Object.keys(kept).length > 0) out[id] = kept;
  }
  return out;
}

/**
 * Environment variables openai-compat may take its key from, for the endpoint it will be sent to.
 * A vendor's variable only goes to that vendor (over https) or to a server on this machine, so a key
 * never reaches a third party by surprise; YGGDRASIL_OPENAI_API_KEY is for whatever URL is set.
 */
export function openAICompatKeyEnvVars(baseUrl?: string): string[] {
  const own = "YGGDRASIL_OPENAI_API_KEY";
  let url: URL;
  try {
    url = new URL(baseUrl?.trim() || "https://api.openai.com/v1");
  } catch {
    return [own];
  }
  const host = url.hostname;
  if (host === "localhost" || host === "[::1]" || /^127(\.\d+){3}$/.test(host)) return ["OLLAMA_API_KEY", "OPENAI_API_KEY", own];
  const is = (domain: string) => url.protocol === "https:" && (host === domain || host.endsWith(`.${domain}`));
  if (is("openai.com")) return ["OPENAI_API_KEY", own];
  if (is("ollama.com")) return ["OLLAMA_API_KEY", own];
  return [own];
}

/** Env var each provider falls back to for its key (same order as the provider packages). */
const PROVIDER_KEY_ENV: Record<string, string[]> = {
  ollama: ["OLLAMA_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
};

export function providerKeyEnvVar(providerId: string, env: NodeJS.ProcessEnv = process.env, baseUrl?: string): string | undefined {
  const names = providerId === "openai-compat" ? openAICompatKeyEnvVars(baseUrl) : PROVIDER_KEY_ENV[providerId];
  return names?.find((name) => env[name]?.trim());
}

/** Effective providers (defaults < global < project, field by field) and where each field came from. */
export function mergeProviderSources(
  defaults: ProvidersMap,
  global: ProvidersMap,
  project: ProvidersMap,
  env: NodeJS.ProcessEnv = process.env,
): { providers: ProvidersMap; sources: ProviderSources } {
  const providers: ProvidersMap = {};
  const sources: ProviderSources = {};
  const ids = new Set([...Object.keys(defaults), ...Object.keys(global), ...Object.keys(project)]);
  for (const id of ids) {
    const entry: ProviderConfig = {};
    const from: ProviderSources[string] = {};
    for (const field of PROVIDER_FIELDS) {
      for (const [layer, name] of [
        [project, "project"],
        [global, "global"],
        [defaults, "default"],
      ] as const) {
        const value = layer[id]?.[field];
        if (value !== undefined) {
          entry[field] = value;
          from[field] = name;
          break;
        }
      }
    }
    if (from.apiKey === undefined && providerKeyEnvVar(id, env, entry.baseUrl)) from.apiKey = "env";
    providers[id] = entry;
    sources[id] = from;
  }
  return { providers, sources };
}
