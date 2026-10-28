export type ToolApprovalPolicy = "always" | "destructive-only" | "never";

export type AgentConfig = {
  id: string;
  label?: string;
  provider?: string;
  model?: string;
  harness?: string;
  systemPrompt?: string;
  contextProviders?: string[];
  /**
   * Restricts which tools this agent may see and call. Each entry is an exact
   * tool name or a prefix pattern ending in `*` (e.g. `phone_*`). Omitted =
   * every registered tool (previous behavior); `[]` = no tools.
   */
  tools?: { allow?: string[] };
};

export type ProviderConfig = {
  baseUrl?: string;
  apiKey?: string;
  defaultModel?: string;
};

export type McpServerConfig =
  | {
      transport: "stdio";
      command: string;
      args?: string[];
      env?: Record<string, string>;
      /** Connect when the gateway boots (default true). When false the server only connects on demand via mcp.reconnect. */
      autoStart?: boolean;
    }
  | {
      transport: "http";
      url: string;
      headers?: Record<string, string>;
      autoStart?: boolean;
    };

export type SessionsConfig = {
  dir?: string;
  maxMessages?: number;
  maxTokens?: number;
  compactThreshold?: number;
  compactionPolicy?: "truncate" | "summarize";
};

export type { AuthConfig, ApiKeyEntry } from "./auth.js";
export {
  resolveGatewayApiKey,
  resolveAllGatewayApiKeys,
  resolveHttpApiKey,
  isGatewayAuthRequired,
  isHttpAuthRequired,
  validateApiKey,
  validateGatewayApiKey,
  parseBearerToken,
} from "./auth.js";

export type YggdrasilConfig = {
  agents?: AgentConfig[];
  defaultAgent?: string;
  /** Free-text language name (e.g. "Spanish", "français") appended as a system instruction on every turn — see turn-kernel.ts's dispatchToHarness. */
  language?: string;
  harness?: {
    policy?: "auto" | "pinned";
    pinnedId?: string;
    maxToolIterations?: number;
    streaming?: boolean;
    compactBeforeTurn?: boolean;
    toolApproval?: ToolApprovalPolicy;
    parallelToolCalls?: boolean;
  };
  auth?: import("./auth.js").AuthConfig;
  plugins?: {
    load?: {
      paths?: string[];
    };
    discoverNodeModules?: boolean;
    discoverAll?: boolean;
    installed?: string[];
    disabled?: string[];
  };
  gateway?: {
    port?: number;
    host?: string;
    tls?: {
      cert?: string; // path to PEM cert file
      key?: string;  // path to PEM key file
    };
  };
  providers?: Record<string, ProviderConfig>;
  mcpServers?: Record<string, McpServerConfig>;
  sessions?: SessionsConfig;
  channels?: Record<string, { enabled?: boolean; accounts?: Record<string, unknown> }>;
  // Server-side external-service connectors (Google Calendar/Gmail, etc.) —
  // same shape as channels for a reason: sanitizeConfigForClient reuses the
  // exact same masking helper for both (see sanitize.ts). Each connector
  // manages its own accounts.<accountId> shape (e.g. connectors.google.
  // accounts.default = {refreshToken, scopes, connectedAt}) and owns its own
  // gateway methods for writing here (connectors.<id>.completeAuth) — this
  // type only needs to be generic enough for sanitize/patch to handle it
  // without knowing what's inside a given connector's account object,
  // external-actions-and-connectors-analysis.md §1.3/§1.4.
  connectors?: Record<string, { enabled?: boolean; accounts?: Record<string, unknown> }>;
  pluginConfig?: Record<string, unknown>;
  context?: {
    defaultProviders?: string[];
    tokenBudget?: number;
  };
};

const PLAN_AGENT_SYSTEM_PROMPT = `You are the planning agent. Think before acting and make the user's intent explicit, not guessed.
- If a request is ambiguous or you're missing information you need, ask a direct clarifying question before doing anything else — don't silently assume.
- When more than one reasonable approach exists, lay out the real options with a one-line tradeoff each, and ask which one the user wants, rather than picking for them.
- Prefer producing a clear, structured plan or checklist over immediately taking execution-style action. State assumptions explicitly if you must make any.
- You have the same tools as any other agent and may use them to inspect/verify/gather information for the plan — but default to a measured, question-first posture rather than rushing to change things.
- Keep plans concrete: concrete steps, concrete targets, called-out risks or open questions — not vague prose.`;

const DEFAULT_AGENT_SYSTEM_PROMPT = `After a tool call returns, never paste its raw JSON/output back to the user as your answer — read it and respond in plain natural language (use a short list or table only if that's clearer than prose).`;

export const DEFAULT_CONFIG: YggdrasilConfig = {
  agents: [
    {
      id: "default",
      label: "Default Agent",
      provider: "openai-compat",
      model: "gpt-4o-mini",
      systemPrompt: DEFAULT_AGENT_SYSTEM_PROMPT,
    },
    {
      id: "plan",
      label: "Plan Agent",
      provider: "openai-compat",
      model: "gpt-4o-mini",
      systemPrompt: PLAN_AGENT_SYSTEM_PROMPT,
    },
  ],
  defaultAgent: "default",
  harness: { policy: "auto" },
  gateway: { port: 18789, host: "127.0.0.1" },
  providers: {
    "openai-compat": {
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-4o-mini",
    },
  },
  sessions: {
    maxMessages: 50,
    compactThreshold: 40,
    compactionPolicy: "summarize",
  },
  plugins: { load: { paths: [] }, discoverNodeModules: true, installed: [], disabled: [] },
  pluginConfig: {},
};

export function mergeConfig(base: YggdrasilConfig, override?: Partial<YggdrasilConfig>): YggdrasilConfig {
  return {
    ...base,
    ...override,
    agents: override?.agents ?? base.agents,
    harness: { ...base.harness, ...override?.harness },
    gateway: { ...base.gateway, ...override?.gateway },
    providers: { ...base.providers, ...override?.providers },
    mcpServers: { ...base.mcpServers, ...override?.mcpServers },
    sessions: { ...base.sessions, ...override?.sessions },
    plugins: {
      load: {
        paths: override?.plugins?.load?.paths ?? base.plugins?.load?.paths ?? [],
      },
      discoverNodeModules: override?.plugins?.discoverNodeModules ?? base.plugins?.discoverNodeModules,
      discoverAll: override?.plugins?.discoverAll ?? base.plugins?.discoverAll,
      installed: override?.plugins?.installed ?? base.plugins?.installed,
      disabled: override?.plugins?.disabled ?? base.plugins?.disabled,
    },
    pluginConfig: { ...base.pluginConfig, ...override?.pluginConfig },
    channels: { ...base.channels, ...override?.channels },
    auth: { ...base.auth, ...override?.auth },
  };
}

export function resolveAgent(config: YggdrasilConfig, agentId?: string): AgentConfig {
  const id = agentId ?? config.defaultAgent ?? "default";
  const agent = config.agents?.find((a) => a.id === id);
  if (!agent) {
    return { id, label: id };
  }
  return agent;
}

/** True when `agent` may use the tool called `toolName` (see AgentConfig.tools). */
export function isToolAllowedForAgent(agent: AgentConfig, toolName: string): boolean {
  const allow = agent.tools?.allow;
  if (!allow) return true;
  return allow.some((pattern) =>
    pattern.endsWith("*") ? toolName.startsWith(pattern.slice(0, -1)) : toolName === pattern,
  );
}

export function buildSessionKey(channelId: string, accountId: string, senderId: string): string {
  return `${channelId}:${accountId}:${senderId}`;
}

export function resolveProviderConfig(
  config: YggdrasilConfig,
  providerId: string,
  ownerPluginId?: string,
): ProviderConfig & Record<string, unknown> {
  const base = config.providers?.[providerId] ?? {};
  const byProvider = (config.pluginConfig?.[providerId] ?? {}) as Record<string, unknown>;
  const byPlugin = ownerPluginId
    ? ((config.pluginConfig?.[ownerPluginId] ?? {}) as Record<string, unknown>)
    : {};
  return { ...base, ...byProvider, ...byPlugin };
}

export {
  CONFIG_FILENAME,
  resolveConfigPath,
  readConfigFile,
  writeConfigFile,
  uniqueStrings,
} from "./file.js";
export { sanitizeConfigForClient } from "./sanitize.js";
export { validateConfigPatch, type ConfigPatchInput, type ConfigPatchResult } from "./patch.js";
export {
  resolveGlobalAgentsPath,
  readGlobalAgents,
  writeGlobalAgents,
  mergeAgentSources,
  type AgentWithScope,
} from "./global-agents.js";
export {
  createAgent,
  type CreateAgentInput,
  deleteAgent,
  type DeleteAgentInput,
  updateAgent,
  type UpdateAgentInput,
} from "./agent-crud.js";
