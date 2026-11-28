// Reading and changing configuration: config.*, provider scope and gateway API keys.

import {
  mergeAgentSources,
  mergeConfig,
  readConfigFile,
  readEffectiveConfig,
  readGlobalAgents,
  restoreMaskedSecrets,
  sanitizeConfigForClient,
  validateConfigPatch,
  writeConfigFile,
} from "@yggdrasil/config";
import { getKernelContext } from "@yggdrasil/kernel";
import { type ProvidersScope, refreshProviders, saveProviderEdits, scopeProvider } from "./globalProviders.js";
import type { GatewayMethodHandler } from "./methods.js";

export interface ConfigMethodsDeps {
  register: (name: string, handler: GatewayMethodHandler) => void;
}

export function registerConfigMethods(deps: ConfigMethodsDeps): void {
  const { register } = deps;

  register("config.get", async (_params, ctx) => {
    const workspaceRoot = ctx.workspaceRoot;
    if (!workspaceRoot) {
      return {
        config: sanitizeConfigForClient(ctx.config),
        workspaceRoot: null,
        configPath: null,
      };
    }
    // Providers come resolved (defaults < ~/.yggdrasil/providers.json < project), with
    // where each field came from, so Settings can say "global" or "this project".
    const { config, path, providerSources } = await readEffectiveConfig(workspaceRoot);
    const globalAgents = await readGlobalAgents();
    const mergedConfig = { ...config, agents: mergeAgentSources(config.agents ?? [], globalAgents) };
    return {
      config: sanitizeConfigForClient(mergedConfig),
      providerSources,
      workspaceRoot,
      configPath: path,
    };
  });

  register("config.patch", async (params, ctx) => {
    const workspaceRoot = ctx.workspaceRoot;
    if (!workspaceRoot) throw new Error("workspaceRoot not configured");

    // Not a config key: where provider edits go (notes/features/global-providers.md).
    const { providersScope: rawScope, ...patchParams } = params as Record<string, unknown>;
    if (rawScope !== undefined && rawScope !== "global" && rawScope !== "project") {
      throw new Error(`config.patch: providersScope must be "global" or "project", got ${JSON.stringify(rawScope)}`);
    }
    const providersScope: ProvidersScope = rawScope ?? "global";
    const { patch, hotReloadedKeys, restartRequiredKeys } = validateConfigPatch(patchParams);

    const { config: current } = await readConfigFile(workspaceRoot);

    // A client that loaded config.get echoes the masks ("***") for tokens/keys back inside whatever it
    // sends. Put the stored secret back so saving unrelated settings never overwrites one.
    if (patch.channels) patch.channels = restoreMaskedSecrets(patch.channels, current.channels);
    if (patch.auth) patch.auth = restoreMaskedSecrets(patch.auth, current.auth);

    // Deep-merge channels so partial updates don't wipe existing accounts
    let channels = current.channels;
    if (patch.channels) {
      channels = { ...current.channels };
      for (const [id, ch] of Object.entries(patch.channels)) {
        channels[id] = { ...channels[id], ...ch };
      }
    }

    const pluginConfig = patch.pluginConfig
      ? { ...current.pluginConfig, ...patch.pluginConfig }
      : current.pluginConfig;

    // Merge agents by id instead of replacing the array wholesale. The
    // client's `patch.agents` is a snapshot fetched whenever its config.get
    // ran (e.g. when the Settings modal opened) — it can predate an
    // agents.create() that landed through a completely different flow
    // (AgentManager) in the meantime. A blind replace here would silently
    // delete that just-created agent the moment the user saved Settings for
    // anything unrelated. Union by id: patch entries add/update, anything
    // only on disk survives untouched.
    let agents = current.agents;
    if (patch.agents) {
      const byId = new Map((current.agents ?? []).map((a) => [a.id, a]));
      for (const a of patch.agents) byId.set(a.id, a);
      agents = [...byId.values()];
    }

    // Provider edits are per field (an omitted field is left alone, so a form that never
    // saw the real key can't wipe it). By default they go to the global file, shared by
    // every project and the TUI, and the project loses those fields; with
    // providersScope "project" they stay in this project only.
    const providers = patch.providers
      ? await saveProviderEdits(workspaceRoot, patch.providers, providersScope)
      : undefined;

    // Same per-id field merge as agents above, and for the same reason:
    // env/headers are stripped out of every config.get response (see
    // sanitizeConfigForClient), so a patch only carries them when the user
    // actually edited that server's secrets — anything else in the patch
    // entry (transport/command/args/url) always merges over the on-disk
    // entry, but an omitted env/headers key here must leave the existing
    // one untouched rather than being treated as "clear it".
    let mcpServers = current.mcpServers;
    if (patch.mcpServers) {
      mcpServers = { ...current.mcpServers };
      for (const [id, s] of Object.entries(patch.mcpServers)) {
        mcpServers[id] = { ...mcpServers[id], ...s } as typeof s;
      }
    }

    const fullPatch = { ...patch, channels, pluginConfig, agents, mcpServers, ...(providers ? { providers } : {}) };

    // Write to disk
    const filePath = await writeConfigFile(workspaceRoot, fullPatch);

    // Apply in-memory immediately
    const globalAgents = await readGlobalAgents();
    const newConfig = mergeConfig(ctx.config, fullPatch);
    newConfig.agents = mergeAgentSources(newConfig.agents ?? [], globalAgents);
    const effective = await readEffectiveConfig(workspaceRoot);
    newConfig.providers = effective.config.providers;
    ctx.config = newConfig;
    // Plugins (providers, the LLM harness) captured the kernel's config object at
    // register time and read it on every turn. Update it in place, or a key/baseUrl
    // saved from Settings stays invisible to chat until the gateway restarts.
    const kernelConfig = getKernelContext()?.config;
    if (kernelConfig && kernelConfig !== newConfig) Object.assign(kernelConfig, newConfig);
    ctx.channelManager?.updateConfig(newConfig);

    // Hot-reload channels: stop disabled, start newly-enabled
    const channelChanges: Array<{ channelId: string; accountId: string; action: "started" | "stopped" }> = [];
    if (patch.channels && ctx.channelManager) {
      for (const [channelId, ch] of Object.entries(patch.channels)) {
        const wasEnabled = current.channels?.[channelId]?.enabled !== false;
        const nowEnabled = (ch as { enabled?: boolean }).enabled !== false;
        const running = ctx.channelManager
          .status()
          .some((s) => s.channelId === channelId && s.running);

        if (wasEnabled && !nowEnabled && running) {
          await ctx.channelManager.stopChannel(channelId, "default");
          channelChanges.push({ channelId, accountId: "default", action: "stopped" });
        } else if (!wasEnabled && nowEnabled && !running) {
          try {
            await ctx.channelManager.startChannel(channelId, "default");
            channelChanges.push({ channelId, accountId: "default", action: "started" });
          } catch (err) {
            ctx.logger.warn(`config.patch: failed to start channel ${channelId}`, {
              error: String(err),
            });
          }
        }
      }
    }

    // mcpServers changes don't connect on their own, but they no longer need
    // a restart: callers follow up with `mcp.reload` (tool-mcp), which diffs
    // the new config against what is connected.
    const requiresRestart = restartRequiredKeys.length > 0;

    return {
      ok: true,
      path: filePath,
      hotReloaded: hotReloadedKeys,
      requiresRestart,
      restartRequiredKeys,
      channelChanges,
      config: sanitizeConfigForClient(newConfig),
      providerSources: effective.providerSources,
    };
  });

  // Settings' "Move to global" / "Use global" for a provider this project overrides
  // (notes/features/global-providers.md). Either way the project stops overriding it.
  register("providers.scope", async (params, ctx) => {
    const workspaceRoot = ctx.workspaceRoot;
    if (!workspaceRoot) throw new Error("providers.scope: this gateway has no workspaceRoot");
    const id = String(params.id ?? "").trim();
    const action = params.action;
    if (!id) throw new Error("providers.scope: id is required");
    if (action !== "moveToGlobal" && action !== "useGlobal") {
      throw new Error(`providers.scope: action must be "moveToGlobal" or "useGlobal", got ${JSON.stringify(action)}`);
    }
    const providers = await scopeProvider(workspaceRoot, id, action);
    await writeConfigFile(workspaceRoot, { providers });
    await refreshProviders(ctx);
    const effective = await readEffectiveConfig(workspaceRoot);
    return { ok: true, config: sanitizeConfigForClient(ctx.config), providerSources: effective.providerSources };
  });

  // "Paired devices" screen (remote-access-analysis.md §5 point 4). Reads
  // straight off ApiKeyEntry (config/src/auth.ts) — no new backend primitive,
  // just the two operations that primitive was missing a way to reach:
  // listing without ever exposing the raw key (config.get already omits
  // apiKeys entirely — see sanitizeConfigForClient — this is the one place
  // that's allowed to know about them, and even here only a preview) and
  // revoking one by name.
  register("auth.apiKeys.list", async (_params, ctx) => {
    const config = ctx.workspaceRoot ? (await readConfigFile(ctx.workspaceRoot)).config : ctx.config;
    const entries = config.auth?.gateway?.apiKeys ?? [];
    return {
      apiKeys: entries.map((e) => ({
        name: e.name,
        expiresAt: e.expiresAt,
        // Last 4 chars only — enough for the user to recognize which device
        // this is without the full key ever leaving the gateway again after
        // it was first issued.
        keyPreview: e.key ? `••••${e.key.slice(-4)}` : undefined,
      })),
    };
  });

  register("auth.apiKeys.revoke", async (params, ctx) => {
    const name = String(params.name ?? "").trim();
    if (!name) throw new Error("auth.apiKeys.revoke: name is required");
    const workspaceRoot = ctx.workspaceRoot;
    if (!workspaceRoot) throw new Error("auth.apiKeys.revoke: this gateway has no workspaceRoot");

    const { config: current } = await readConfigFile(workspaceRoot);
    const existing = current.auth?.gateway?.apiKeys ?? [];
    const remaining = existing.filter((e) => e.name !== name);
    if (remaining.length === existing.length) {
      throw new Error(`auth.apiKeys.revoke: no apiKey named "${name}"`);
    }

    // Deep-merged by hand rather than via config.patch's validateConfigPatch
    // pipeline (same reasoning as agents.create/update/delete) — auth isn't
    // one of mergeConfig's explicitly-merged keys, so writing just
    // {auth:{gateway:{apiKeys}}} would silently drop apiKey/required
    // (the legacy single key + the require-auth flag) if not spread through
    // by hand first.
    const patch = {
      auth: {
        ...current.auth,
        gateway: { ...current.auth?.gateway, apiKeys: remaining },
      },
    };
    await writeConfigFile(workspaceRoot, patch);
    ctx.config = mergeConfig(ctx.config, patch);

    return { ok: true, revoked: name, remaining: remaining.length };
  });
}
