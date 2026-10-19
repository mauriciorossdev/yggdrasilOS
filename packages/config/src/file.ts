import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_CONFIG, mergeConfig, type YggdrasilConfig } from "./index.js";

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

export async function writeConfigFile(
  workspaceRoot: string,
  partial: Partial<YggdrasilConfig>,
): Promise<string> {
  const { config: current, path } = await readConfigFile(workspaceRoot);
  const next = mergeConfig(current, partial);
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return path;
}

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}
