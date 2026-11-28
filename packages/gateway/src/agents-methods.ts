// Agent configs, skill commands, harness/provider listings and the one-shot automation author.

import {
  type AgentConfig,
  createAgent,
  deleteAgent,
  mergeAgentSources,
  readConfigFile,
  readGlobalAgents,
  resolveProviderConfig,
  updateAgent,
} from "@yggdrasil/config";
import { getProvider, listHarnesses, listProviders, listSkillCommands } from "@yggdrasil/kernel";
import type { GatewayMethodHandler } from "./methods.js";

export interface AgentMethodsDeps {
  register: (name: string, handler: GatewayMethodHandler) => void;
}

export function registerAgentMethods(deps: AgentMethodsDeps): void {
  const { register } = deps;

  register("skills.commands", async () => ({
    commands: listSkillCommands(),
  }));

  register("agents.list", async (_params, ctx) => {
    const projectAgents = ctx.workspaceRoot
      ? ((await readConfigFile(ctx.workspaceRoot)).config.agents ?? [])
      : (ctx.config.agents ?? []);
    const globalAgents = await readGlobalAgents();
    const merged = mergeAgentSources(projectAgents, globalAgents);
    return {
      agents: merged.map((a) => ({
        ...a,
        systemPrompt: a.systemPrompt ? a.systemPrompt.slice(0, 200) : undefined,
      })),
      defaultAgent: ctx.config.defaultAgent,
    };
  });

  // Omitted = undefined, so an update keeps what is stored. `{}` clears the restriction; `{ allow: [] }` means no tools at all (see AgentConfig.tools).
  const parseAgentTools = (raw: unknown): AgentConfig["tools"] => {
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("agents: tools must be an object like { allow: string[] }");
    const allow = (raw as { allow?: unknown }).allow;
    if (allow === undefined) return {};
    if (!Array.isArray(allow) || allow.some((t) => typeof t !== "string")) throw new Error("agents: tools.allow must be an array of strings");
    return { allow: allow as string[] };
  };

  register("agents.create", async (params, ctx) => {
    const id = String(params.id ?? "").trim();
    if (!id) throw new Error("agents.create: id is required");
    const scope = params.scope;
    if (scope !== "local" && scope !== "global") {
      throw new Error(`agents.create: scope must be "local" or "global", got ${JSON.stringify(scope)}`);
    }
    const agent: AgentConfig = {
      id,
      label: params.label !== undefined ? String(params.label) : undefined,
      provider: params.provider !== undefined ? String(params.provider) : undefined,
      model: params.model !== undefined ? String(params.model) : undefined,
      harness: params.harness !== undefined ? String(params.harness) : undefined,
      systemPrompt: params.systemPrompt !== undefined ? String(params.systemPrompt) : undefined,
      contextProviders: Array.isArray(params.contextProviders)
        ? (params.contextProviders as string[])
        : undefined,
      tools: parseAgentTools(params.tools),
    };

    const created = await createAgent({ agent, scope, workspaceRoot: ctx.workspaceRoot });

    // Refresh in-memory ctx.config.agents so the new agent is immediately usable
    // in this gateway process without a restart (mirrors config.patch's eager update).
    const globalAgents = await readGlobalAgents();
    const projectAgents = ctx.workspaceRoot
      ? ((await readConfigFile(ctx.workspaceRoot)).config.agents ?? [])
      : (ctx.config.agents ?? []);
    ctx.config.agents = mergeAgentSources(projectAgents, globalAgents);

    return { ok: true, agent: created };
  });

  // Full, untruncated agent config for editing — agents.list truncates
  // systemPrompt to 200 chars for display-only contexts (chat/agent
  // pickers), which would silently clip a long system prompt if reused to
  // pre-fill an edit form.
  register("agents.get", async (params, ctx) => {
    const id = String(params.id ?? "").trim();
    if (!id) throw new Error("agents.get: id is required");
    const scope = params.scope;
    if (scope !== "local" && scope !== "global") {
      throw new Error(`agents.get: scope must be "local" or "global", got ${JSON.stringify(scope)}`);
    }
    const source =
      scope === "local"
        ? (ctx.workspaceRoot ? (await readConfigFile(ctx.workspaceRoot)).config.agents : ctx.config.agents) ?? []
        : await readGlobalAgents();
    const agent = source.find((a) => a.id === id);
    if (!agent) throw new Error(`agents.get: agent "${id}" not found in ${scope} scope`);
    return { agent: { ...agent, scope } };
  });

  register("agents.update", async (params, ctx) => {
    const id = String(params.id ?? "").trim();
    if (!id) throw new Error("agents.update: id is required");
    const scope = params.scope;
    if (scope !== "local" && scope !== "global") {
      throw new Error(`agents.update: scope must be "local" or "global", got ${JSON.stringify(scope)}`);
    }
    const agent: AgentConfig = {
      id,
      label: params.label !== undefined ? String(params.label) : undefined,
      provider: params.provider !== undefined ? String(params.provider) : undefined,
      model: params.model !== undefined ? String(params.model) : undefined,
      harness: params.harness !== undefined ? String(params.harness) : undefined,
      systemPrompt: params.systemPrompt !== undefined ? String(params.systemPrompt) : undefined,
      contextProviders: Array.isArray(params.contextProviders)
        ? (params.contextProviders as string[])
        : undefined,
      tools: parseAgentTools(params.tools),
    };

    const updated = await updateAgent({ agent, scope, workspaceRoot: ctx.workspaceRoot });

    const globalAgents = await readGlobalAgents();
    const projectAgents = ctx.workspaceRoot
      ? ((await readConfigFile(ctx.workspaceRoot)).config.agents ?? [])
      : (ctx.config.agents ?? []);
    ctx.config.agents = mergeAgentSources(projectAgents, globalAgents);

    return { ok: true, agent: updated };
  });

  register("agents.delete", async (params, ctx) => {
    const id = String(params.id ?? "").trim();
    if (!id) throw new Error("agents.delete: id is required");
    const scope = params.scope;
    if (scope !== "local" && scope !== "global") {
      throw new Error(`agents.delete: scope must be "local" or "global", got ${JSON.stringify(scope)}`);
    }

    await deleteAgent({ id, scope, workspaceRoot: ctx.workspaceRoot });

    // Refresh in-memory ctx.config.agents so the removal is immediately
    // reflected without a restart — mirrors agents.create/agents.update.
    const globalAgents = await readGlobalAgents();
    const projectAgents = ctx.workspaceRoot
      ? ((await readConfigFile(ctx.workspaceRoot)).config.agents ?? [])
      : (ctx.config.agents ?? []);
    ctx.config.agents = mergeAgentSources(projectAgents, globalAgents);

    return { ok: true };
  });

  register("harnesses.list", async () => ({
    harnesses: listHarnesses().map(({ harness }) => ({
      id: harness.id,
      label: harness.label,
      pluginId: harness.pluginId,
    })),
  }));

  register("providers.list", async (_params, ctx) => {
    const providers = listProviders();
    // Each provider is resolved independently — one unreachable host (a dead
    // LAN IP, a provider down) must not take out the whole response. Before
    // this, a single rejected listModels() call failed the entire
    // Promise.all, which meant Settings couldn't load *at all* just because
    // one configured provider's URL was down.
    const models = await Promise.all(
      providers.map(async (p) => {
        try {
          const pctx = { config: resolveProviderConfig(ctx.config, p.id) };
          // A provider that can resolve an API key authenticates with one: tell the UI
          // whether it has it (config or env var) without ever sending the key itself.
          const needsKey = typeof p.resolveApiKey === "function";
          const configured = needsKey ? Boolean(await p.resolveApiKey!(pctx)) : true;
          return {
            id: p.id,
            label: p.label,
            needsKey,
            configured,
            models: await p.listModels(pctx),
          };
        } catch (err) {
          return {
            id: p.id,
            label: p.label,
            needsKey: typeof p.resolveApiKey === "function",
            configured: false,
            models: [],
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );
    return { providers: models };
  });

  register("automation.author", async (params, ctx) => {
    const system = String(params.system ?? "");
    const user = String(params.user ?? "");
    if (!user.trim()) throw new Error("automation.author: user is required");
    const agent = (ctx.config.agents ?? []).find((a) => a.id === ctx.config.defaultAgent);
    if (!agent?.provider || !agent.model) {
      throw new Error("automation.author: default agent has no provider/model");
    }
    const provider = getProvider(agent.provider);
    if (!provider?.chatComplete) {
      throw new Error(`automation.author: provider "${agent.provider}" cannot chat`);
    }
    const providerCfg = resolveProviderConfig(ctx.config, agent.provider);
    const result = await provider.chatComplete(
      { config: providerCfg },
      {
        model: agent.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.2,
      },
    );
    return { text: result.text, model: result.model };
  });
}
