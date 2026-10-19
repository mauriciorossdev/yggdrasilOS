import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export const CONFIG_FILENAME = "yggdrasil.config.json";

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Walk up from `startDir` looking for yggdrasil.config.json. */
export async function findConfigPath(startDir = process.cwd()): Promise<string | undefined> {
  let dir = resolve(startDir);
  const root = resolve("/");

  while (true) {
    const candidate = join(dir, CONFIG_FILENAME);
    if (await pathExists(candidate)) {
      return candidate;
    }
    if (dir === root) break;
    dir = dirname(dir);
  }

  return undefined;
}

/**
 * Project root for plugin discovery and config I/O.
 * 1. YGGDRASIL_WORKSPACE env
 * 2. Directory containing yggdrasil.config.json (walk up from cwd)
 * 3. cwd
 */
export async function resolveWorkspaceRoot(cwd = process.cwd()): Promise<string> {
  const fromEnv = process.env.YGGDRASIL_WORKSPACE?.trim();
  if (fromEnv) {
    return resolve(fromEnv);
  }

  const configPath = await findConfigPath(cwd);
  if (configPath) {
    return dirname(configPath);
  }

  return resolve(cwd);
}

export function resolveConfigPath(workspaceRoot: string): string {
  return join(workspaceRoot, CONFIG_FILENAME);
}
