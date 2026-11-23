import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_CONFIG, mergeConfig, type YggdrasilConfig } from "./index.js";
import {
  cleanProviders,
  mergeProviderSources,
  projectOwnProviders,
  readGlobalProviders,
  type ProviderSources,
  type ProvidersMap,
} from "./global-providers.js";

export const CONFIG_FILENAME = "yggdrasil.config.json";

export function resolveConfigPath(workspaceRoot: string): string {
  return join(workspaceRoot, CONFIG_FILENAME);
}

export async function readConfigFile(workspaceRoot: string): Promise<{
  config: YggdrasilConfig;
  exists: boolean;
  path: string;
}> {
  const path = resolveConfigPath(workspaceRoot);
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as Partial<YggdrasilConfig>;
    return { config: mergeConfig(DEFAULT_CONFIG, raw), exists: true, path };
  } catch {
    return { config: { ...DEFAULT_CONFIG }, exists: false, path };
  }
}

/** The project file as written, without defaults merged in ({} when missing or malformed). */
export async function readRawConfigFile(workspaceRoot: string): Promise<Partial<YggdrasilConfig>> {
  try {
    return JSON.parse(await readFile(resolveConfigPath(workspaceRoot), "utf8")) as Partial<YggdrasilConfig>;
  } catch {
    return {};
  }
}

/** Providers this project set on purpose (fields equal to the built-in defaults don't count). */
export async function readProjectProviders(workspaceRoot: string): Promise<ProvidersMap> {
  const raw = await readRawConfigFile(workspaceRoot);
  return projectOwnProviders(raw.providers, cleanProviders(DEFAULT_CONFIG.providers));
}

/**
 * The config a gateway runs with: the project's file over the defaults, with providers
 * resolved field by field as defaults < ~/.yggdrasil/providers.json < project
 * (notes/features/global-providers.md). `providerSources` says where each field came from.
 */
export async function readEffectiveConfig(workspaceRoot: string): Promise<{
  config: YggdrasilConfig;
  providerSources: ProviderSources;
  exists: boolean;
  path: string;
}> {
  const { config, exists, path } = await readConfigFile(workspaceRoot);
  const merged = mergeProviderSources(
    cleanProviders(DEFAULT_CONFIG.providers),
    await readGlobalProviders(),
    await readProjectProviders(workspaceRoot),
  );
  return { config: { ...config, providers: merged.providers }, providerSources: merged.sources, exists, path };
}

export async function writeConfigFile(
  workspaceRoot: string,
  partial: Partial<YggdrasilConfig>,
): Promise<string> {
  const { config: current, path } = await readConfigFile(workspaceRoot);
  const raw = await readRawConfigFile(workspaceRoot);
  const next = mergeConfig(current, partial);
  // Providers are written as the project's own set only: `partial.providers`, when given,
  // replaces them whole; otherwise the file's own stay. Never the built-in defaults — those
  // copies used to land in every project and would hide the global providers.
  const own = projectOwnProviders(
    partial.providers !== undefined ? partial.providers : raw.providers,
    cleanProviders(DEFAULT_CONFIG.providers),
  );
  if (Object.keys(own).length > 0) next.providers = own;
  else delete next.providers;
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return path;
}

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}
