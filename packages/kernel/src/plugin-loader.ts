import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { YggdrasilConfig } from "@yggdrasil/config";
import {
  PLUGIN_MANIFEST_FILENAME,
  isPluginApiCompatible,
  parsePluginManifest,
  type EventBus,
  type YggdrasilPlugin,
  type YggdrasilPluginManifest,
} from "@yggdrasil/sdk";
import { createPluginApi } from "./plugin-api.js";
import { createConsoleLogger, createEventBus, registerPlugin } from "./registry.js";

export type PluginCandidate = {
  rootDir: string;
  manifest: YggdrasilPluginManifest;
  manifestPath: string;
};

export type LoadPluginsOptions = {
  config: YggdrasilConfig;
  pluginConfig?: Record<string, unknown>;
  searchPaths?: string[];
  bundledPlugins?: YggdrasilPlugin[];
  /**
   * The EventBus every loaded plugin's `register(api)` receives as
   * `api.events`. Callers that care about plugin-emitted events reaching
   * anything else (e.g. lifecycle.ts's bootstrapKernel, which shares this
   * with the gateway's own real broadcast bus — see KernelContext.events'
   * doc comment) pass their own; omitted, a fresh isolated bus is created
   * (unchanged behavior for every existing caller, including tests that
   * don't care).
   */
  events?: EventBus;
};

export type LoadPluginsResult = {
  loaded: string[];
  errors: Array<{ path: string; error: string }>;
};

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function discoverNodeModulesPluginPaths(
  workspaceRoot: string,
  options?: { discoverAll?: boolean },
): Promise<string[]> {
  const paths: string[] = [];
  const scoped = join(workspaceRoot, "node_modules/@yggdrasil");
  if (await fileExists(scoped)) {
    paths.push(scoped);
  }
  if (options?.discoverAll) {
    const rootModules = join(workspaceRoot, "node_modules");
    if (await fileExists(rootModules)) {
      paths.push(rootModules);
    }
  }
  return paths;
}

export async function discoverPlugins(searchPaths: string[]): Promise<PluginCandidate[]> {
  const candidates: PluginCandidate[] = [];
  const seen = new Set<string>();

  for (const searchPath of searchPaths) {
    const abs = resolve(searchPath);
    if (!(await fileExists(abs))) continue;

    const manifestPath = join(abs, PLUGIN_MANIFEST_FILENAME);
    if (await fileExists(manifestPath)) {
      const raw = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
      const manifest = parsePluginManifest(raw);
      if (!isPluginApiCompatible(manifest.compat?.pluginApi)) {
        continue;
      }
      if (!seen.has(manifest.id)) {
        seen.add(manifest.id);
        candidates.push({ rootDir: abs, manifest, manifestPath });
      }
      continue;
    }

    const entries = await readdir(abs, { withFileTypes: true });
    for (const entry of entries) {
      // pnpm workspaces symlink every package into node_modules/@yggdrasil —
      // Dirent.isDirectory() reflects the raw dirent type and is false for
      // symlinks (even ones pointing at a directory) on every platform, so
      // it can't be the sole filter here or symlinked packages are silently
      // skipped. fileExists() below does a real stat() (follows symlinks)
      // and is the actual gate; this just skips plain files cheaply first.
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const sub = join(abs, entry.name);
      const subManifest = join(sub, PLUGIN_MANIFEST_FILENAME);
      if (!(await fileExists(subManifest))) continue;
      const raw = JSON.parse(await readFile(subManifest, "utf8")) as unknown;
      const manifest = parsePluginManifest(raw);
      if (!isPluginApiCompatible(manifest.compat?.pluginApi)) {
        continue;
      }
      if (seen.has(manifest.id)) continue;
      seen.add(manifest.id);
      candidates.push({ rootDir: sub, manifest, manifestPath: subManifest });
    }
  }

  return candidates;
}

export async function importPluginModule(
  candidate: PluginCandidate,
  bustCache = false,
): Promise<YggdrasilPlugin> {
  const entryPath = resolve(candidate.rootDir, candidate.manifest.entry);
  const url = pathToFileURL(entryPath).href + (bustCache ? `?t=${Date.now()}` : "");
  const mod = (await import(url)) as {
    default?: YggdrasilPlugin;
  };
  const plugin = mod.default;
  if (!plugin?.id && !plugin?.register) {
    throw new Error(`Plugin entry ${entryPath} must export default YggdrasilPlugin`);
  }
  return { ...plugin, id: plugin.id ?? candidate.manifest.id };
}

export async function loadPlugins(options: LoadPluginsOptions): Promise<LoadPluginsResult> {
  const loaded: string[] = [];
  const errors: Array<{ path: string; error: string }> = [];
  const events = options.events ?? createEventBus();
  const loadedIds = new Set<string>();

  const disabled = new Set(options.config?.plugins?.disabled ?? []);

  for (const bundled of options.bundledPlugins ?? []) {
    try {
      if (loadedIds.has(bundled.id)) continue;
      if (disabled.has(bundled.id)) continue;
      const api = createPluginApi({
        pluginId: bundled.id,
        config: options.pluginConfig?.[bundled.id] ?? {},
        globalConfig: options.config,
        events,
      });
      await bundled.register(api);
      registerPlugin({ id: bundled.id, name: bundled.name, version: bundled.version, module: bundled });
      loadedIds.add(bundled.id);
      loaded.push(bundled.id);
    } catch (err) {
      errors.push({ path: bundled.id, error: String(err) });
    }
  }

  const candidates = await discoverPlugins(options.searchPaths ?? []);
  for (const candidate of candidates) {
    if (loadedIds.has(candidate.manifest.id)) continue;
    if (disabled.has(candidate.manifest.id)) continue;
    try {
      const plugin = await importPluginModule(candidate);
      const api = createPluginApi({
        pluginId: plugin.id,
        config: options.pluginConfig?.[plugin.id] ?? {},
        globalConfig: options.config,
        logger: createConsoleLogger(plugin.id),
        events,
      });
      await plugin.register(api);
      registerPlugin({
        id: plugin.id,
        name: plugin.name ?? candidate.manifest.name,
        version: plugin.version ?? candidate.manifest.version,
        module: plugin,
      });
      loadedIds.add(plugin.id);
      loaded.push(plugin.id);
    } catch (err) {
      errors.push({ path: candidate.rootDir, error: String(err) });
    }
  }

  return { loaded, errors };
}

export async function readPluginManifest(manifestPath: string): Promise<YggdrasilPluginManifest> {
  const raw = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  return parsePluginManifest(raw);
}

export function resolvePluginSearchPaths(options: {
  workspaceRoot: string;
  config?: YggdrasilConfig;
  extraPaths?: string[];
}): string[] {
  const root = options.workspaceRoot;
  return [
    join(root, "packages"),
    join(root, "extensions"),
    ...(options.extraPaths ?? []).map((p) => resolve(root, p)),
  ];
}

export async function resolvePluginSearchPathsAsync(options: {
  workspaceRoot: string;
  config?: YggdrasilConfig;
  extraPaths?: string[];
}): Promise<string[]> {
  const base = resolvePluginSearchPaths(options);
  const discoverNodeModules = options.config?.plugins?.discoverNodeModules !== false;
  if (!discoverNodeModules) return base;

  const nmPaths = await discoverNodeModulesPluginPaths(options.workspaceRoot, {
    discoverAll: options.config?.plugins?.discoverAll,
  });
  return [...base, ...nmPaths];
}
