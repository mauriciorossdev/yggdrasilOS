import type { McpServerConfig, YggdrasilConfig } from "./index.js";

const HOT_RELOAD_KEYS = new Set([
  "agents",
  "defaultAgent",
  "language",
  "harness",
  "auth",
  "channels",
  "pluginConfig",
  "context",
  "providers",
  "mcpServers",
]);

const RESTART_KEYS = new Set([
  "sessions",  // session store re-init needed
]);

const ALL_ALLOWED = new Set([...HOT_RELOAD_KEYS, ...RESTART_KEYS]);

export type ConfigPatchInput = Partial<Pick<
  YggdrasilConfig,
  | "agents"
  | "defaultAgent"
  | "language"
  | "harness"
  | "auth"
  | "channels"
  | "pluginConfig"
  | "context"
  | "providers"
  | "mcpServers"
  | "sessions"
>>;

export type ConfigPatchResult = {
  patch: ConfigPatchInput;
  hotReloadedKeys: string[];
  restartRequiredKeys: string[];
};

export function validateConfigPatch(input: Record<string, unknown>): ConfigPatchResult {
  const forbidden = Object.keys(input).filter((k) => !ALL_ALLOWED.has(k));
  if (forbidden.length > 0) {
    throw new Error(
      `config.patch: forbidden keys: ${forbidden.join(", ")}. ` +
      `Cannot patch at runtime: gateway (port/host/tls), plugins (installed/disabled/paths).`,
    );
  }

  const patch: ConfigPatchInput = {};
  const hotReloadedKeys: string[] = [];
  const restartRequiredKeys: string[] = [];

  if (input.agents !== undefined) {
    if (!Array.isArray(input.agents)) throw new Error("config.patch: agents must be an array");
    patch.agents = input.agents as YggdrasilConfig["agents"];
    hotReloadedKeys.push("agents");
  }

  if (input.defaultAgent !== undefined) {
    patch.defaultAgent = String(input.defaultAgent);
    hotReloadedKeys.push("defaultAgent");
  }

  if (input.language !== undefined) {
    const language = String(input.language).trim();
    patch.language = language || undefined;
    hotReloadedKeys.push("language");
  }

  if (input.harness !== undefined) {
    if (typeof input.harness !== "object" || input.harness === null)
      throw new Error("config.patch: harness must be an object");
    patch.harness = input.harness as YggdrasilConfig["harness"];
    hotReloadedKeys.push("harness");
  }

  if (input.auth !== undefined) {
    if (typeof input.auth !== "object" || input.auth === null)
      throw new Error("config.patch: auth must be an object");
    patch.auth = input.auth as YggdrasilConfig["auth"];
    hotReloadedKeys.push("auth");
  }

  if (input.channels !== undefined) {
    if (typeof input.channels !== "object" || input.channels === null)
      throw new Error("config.patch: channels must be an object");
    const channels: NonNullable<YggdrasilConfig["channels"]> = {};
    for (const [id, ch] of Object.entries(input.channels as Record<string, unknown>)) {
      if (!ch || typeof ch !== "object") continue;
      channels[id] = ch as { enabled?: boolean; accounts?: Record<string, unknown> };
    }
    patch.channels = channels;
    hotReloadedKeys.push("channels");
  }

  if (input.pluginConfig !== undefined) {
    if (typeof input.pluginConfig !== "object" || input.pluginConfig === null)
      throw new Error("config.patch: pluginConfig must be an object");
    patch.pluginConfig = input.pluginConfig as Record<string, unknown>;
    hotReloadedKeys.push("pluginConfig");
  }

  if (input.context !== undefined) {
    if (typeof input.context !== "object" || input.context === null)
      throw new Error("config.patch: context must be an object");
    patch.context = input.context as YggdrasilConfig["context"];
    hotReloadedKeys.push("context");
  }

  if (input.providers !== undefined) {
    if (typeof input.providers !== "object" || input.providers === null) {
      throw new Error("config.patch: providers must be an object");
    }
    const providers: NonNullable<YggdrasilConfig["providers"]> = {};
    for (const [id, p] of Object.entries(input.providers as Record<string, unknown>)) {
      if (!p || typeof p !== "object") continue;
      const provider = p as { baseUrl?: unknown; apiKey?: unknown; defaultModel?: unknown };
      // Only include fields the caller actually sent — an explicit `undefined`
      // here would still win over an existing value when the gateway handler
      // merges this against current on-disk state via object spread.
      const entry: NonNullable<YggdrasilConfig["providers"]>[string] = {};
      if (provider.baseUrl !== undefined) entry.baseUrl = String(provider.baseUrl);
      if (provider.apiKey !== undefined) entry.apiKey = String(provider.apiKey);
      if (provider.defaultModel !== undefined) entry.defaultModel = String(provider.defaultModel);
      providers[id] = entry;
    }
    patch.providers = providers;
    hotReloadedKeys.push("providers");
  }

  if (input.mcpServers !== undefined) {
    if (typeof input.mcpServers !== "object" || input.mcpServers === null) {
      throw new Error("config.patch: mcpServers must be an object");
    }
    const mcpServers: NonNullable<YggdrasilConfig["mcpServers"]> = {};
    for (const [id, s] of Object.entries(input.mcpServers as Record<string, unknown>)) {
      if (!s || typeof s !== "object") continue;
      const server = s as Record<string, unknown>;

      if (server.transport === "stdio") {
        const entry: Extract<McpServerConfig, { transport: "stdio" }> = {
          transport: "stdio",
          command: String(server.command ?? ""),
        };
        if (server.args !== undefined) {
          entry.args = (server.args as unknown[]).map(String);
        }
        // env is write-only from the client's point of view (never sent back
        // masked, see sanitizeConfigForClient) — only present here at all
        // when the user actually edited it, same reasoning as providers.apiKey.
        if (server.env !== undefined && typeof server.env === "object" && server.env !== null) {
          entry.env = Object.fromEntries(
            Object.entries(server.env as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
          );
        }
        mcpServers[id] = entry;
      } else if (server.transport === "http") {
        const entry: Extract<McpServerConfig, { transport: "http" }> = {
          transport: "http",
          url: String(server.url ?? ""),
        };
        if (server.headers !== undefined && typeof server.headers === "object" && server.headers !== null) {
          entry.headers = Object.fromEntries(
            Object.entries(server.headers as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
          );
        }
        mcpServers[id] = entry;
      } else {
        throw new Error(`config.patch: mcpServers.${id}.transport must be "stdio" or "http"`);
      }
    }
    patch.mcpServers = mcpServers;
    hotReloadedKeys.push("mcpServers");
  }

  if (input.sessions !== undefined) {
    if (typeof input.sessions !== "object" || input.sessions === null)
      throw new Error("config.patch: sessions must be an object");
    patch.sessions = input.sessions as YggdrasilConfig["sessions"];
    restartRequiredKeys.push("sessions");
  }

  return { patch, hotReloadedKeys, restartRequiredKeys };
}
