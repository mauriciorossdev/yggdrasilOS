import { watch, type FSWatcher } from "node:fs";
import { mkdirSync } from "node:fs";
import { basename, dirname } from "node:path";
import {
  applyProviderEdits,
  readEffectiveConfig,
  readGlobalProviders,
  readProjectProviders,
  removeProviderFields,
  resolveGlobalProvidersPath,
  writeGlobalProviders,
  type ProviderConfig,
  type ProviderField,
  type ProvidersMap,
} from "@yggdrasil/config";
import { getKernelContext } from "@yggdrasil/kernel";
import type { GatewayContext } from "./methods.js";

/**
 * Gateway side of notes/features/global-providers.md: saving providers to
 * ~/.yggdrasil/providers.json (or, on request, to the project), and keeping
 * this gateway's running config in step when another gateway — another
 * project window, or the TUI — changes that file.
 */

export type ProvidersScope = "global" | "project";

/**
 * Where a config.patch's provider edits land. Global (the default): the global file gets
 * them and the project loses those same fields, so its old value can't hide the new one.
 * Project: only the project's own set changes. Returns the project's new own providers,
 * to be written with the rest of the patch.
 */
export async function saveProviderEdits(
  workspaceRoot: string,
  edits: Record<string, Partial<ProviderConfig>>,
  scope: ProvidersScope,
): Promise<ProvidersMap> {
  const project = await readProjectProviders(workspaceRoot);
  if (scope === "project") return applyProviderEdits(project, edits);
  await writeGlobalProviders(applyProviderEdits(await readGlobalProviders(), edits));
  const edited: Record<string, ProviderField[]> = {};
  for (const [id, edit] of Object.entries(edits)) {
    edited[id] = (Object.keys(edit) as ProviderField[]).filter((f) => edit[f] !== undefined);
  }
  return removeProviderFields(project, edited);
}

/**
 * "Move to global" copies a project's own values for one provider into the global file;
 * "Use global" just drops them. Either way the project stops overriding that provider.
 * Returns the project's new own providers.
 */
export async function scopeProvider(
  workspaceRoot: string,
  providerId: string,
  action: "moveToGlobal" | "useGlobal",
): Promise<ProvidersMap> {
  const project = await readProjectProviders(workspaceRoot);
  const own = project[providerId];
  if (action === "moveToGlobal" && own) {
    await writeGlobalProviders(applyProviderEdits(await readGlobalProviders(), { [providerId]: own }));
  }
  const { [providerId]: _dropped, ...rest } = project;
  return rest;
}

/** Re-reads the effective providers into this gateway's config and the kernel's (what providers read each turn). */
export async function refreshProviders(ctx: GatewayContext): Promise<void> {
  if (!ctx.workspaceRoot) return;
  const { config } = await readEffectiveConfig(ctx.workspaceRoot);
  const providers = config.providers ?? {};
  ctx.config = { ...ctx.config, providers };
  const kernelConfig = getKernelContext()?.config;
  if (kernelConfig) kernelConfig.providers = providers;
}

/**
 * Applies changes to ~/.yggdrasil/providers.json made by any other gateway (another project
 * window, the TUI) without a restart. Watches the folder, since the file is replaced by
 * rename on every save and may not exist yet.
 */
export function watchGlobalProviders(ctx: GatewayContext, debounceMs = 300): () => void {
  if (!ctx.workspaceRoot) return () => {};
  const file = resolveGlobalProvidersPath();
  let watcher: FSWatcher;
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    let timer: ReturnType<typeof setTimeout> | null = null;
    watcher = watch(dirname(file), { persistent: false }, (_event, name) => {
      if (name && name.toString() !== basename(file)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        refreshProviders(ctx).catch((err) => ctx.logger.warn("global providers reload failed", { error: String(err) }));
      }, debounceMs);
    });
  } catch (err) {
    ctx.logger.warn("not watching global providers", { error: String(err) });
    return () => {};
  }
  return () => watcher.close();
}
