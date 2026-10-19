import type { YggdrasilConfig } from "./index.js";

const MASK = "***";

function maskSecret(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return MASK;
}

function sanitizeAccounts(accounts: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!accounts) return undefined;
  const out: Record<string, unknown> = {};
  for (const [id, cfg] of Object.entries(accounts)) {
    if (!cfg || typeof cfg !== "object") {
      out[id] = cfg;
      continue;
    }
    const account = { ...(cfg as Record<string, unknown>) };
    if (account.token) account.token = MASK;
    if (account.botToken) account.botToken = MASK;
    if (account.apiKey) account.apiKey = MASK;
    // OAuth connector accounts (connectors.<id>.accounts.<accountId>, e.g.
    // connectors.google) store a long-lived refresh token here — same
    // never-leave-the-gateway rule as apiKey/token above (external-actions-
    // and-connectors-analysis.md §1.3).
    if (account.refreshToken) account.refreshToken = MASK;
    out[id] = account;
  }
  return out;
}

// Shared by channels and connectors — both are a Record<id, {enabled,
// accounts}>, and the masking logic (sanitizeAccounts) doesn't care which
// kind of account it is.
type AccountsMapConfig = Record<string, { enabled?: boolean; accounts?: Record<string, unknown> }> | undefined;

function sanitizeAccountsMap(map: AccountsMapConfig): AccountsMapConfig {
  if (!map) return undefined;
  const out: NonNullable<AccountsMapConfig> = {};
  for (const [id, entry] of Object.entries(map)) {
    out[id] = {
      enabled: entry.enabled,
      accounts: sanitizeAccounts(entry.accounts as Record<string, unknown> | undefined),
    };
  }
  return out;
}

function sanitizeProviders(
  providers: YggdrasilConfig["providers"],
): YggdrasilConfig["providers"] {
  if (!providers) return undefined;
  const out: NonNullable<YggdrasilConfig["providers"]> = {};
  for (const [id, p] of Object.entries(providers)) {
    out[id] = {
      baseUrl: p.baseUrl,
      defaultModel: p.defaultModel,
      apiKey: maskSecret(p.apiKey),
    };
  }
  return out;
}

function sanitizeMcpServers(
  servers: YggdrasilConfig["mcpServers"],
): YggdrasilConfig["mcpServers"] {
  if (!servers) return undefined;
  const out: NonNullable<YggdrasilConfig["mcpServers"]> = {};
  for (const [id, s] of Object.entries(servers)) {
    // env/headers are dropped entirely rather than masked to "***" — unlike
    // apiKey (a single scalar the client always resends whole or omits),
    // these are open-ended key/value maps the Settings UI can't reliably
    // diff field-by-field. Masking a value the client then blindly resends
    // would overwrite the real secret with the literal string "***"; leaving
    // the key out entirely forces the write-only edit flow (see patch.ts)
    // instead.
    out[id] =
      s.transport === "stdio"
        ? { transport: "stdio", command: s.command, args: s.args }
        : { transport: "http", url: s.url };
  }
  return out;
}

/** Config safe to expose over gateway RPC (secrets masked). */
export function sanitizeConfigForClient(config: YggdrasilConfig): YggdrasilConfig {
  return {
    agents: config.agents,
    defaultAgent: config.defaultAgent,
    language: config.language,
    harness: config.harness,
    gateway: config.gateway,
    sessions: config.sessions
      ? {
          maxMessages: config.sessions.maxMessages,
          maxTokens: config.sessions.maxTokens,
          compactThreshold: config.sessions.compactThreshold,
          compactionPolicy: config.sessions.compactionPolicy,
        }
      : undefined,
    plugins: config.plugins
      ? {
          installed: config.plugins.installed,
          disabled: config.plugins.disabled,
          discoverNodeModules: config.plugins.discoverNodeModules,
        }
      : undefined,
    channels: sanitizeAccountsMap(config.channels),
    connectors: sanitizeAccountsMap(config.connectors),
    providers: sanitizeProviders(config.providers),
    mcpServers: sanitizeMcpServers(config.mcpServers),
    auth: config.auth
      ? {
          gateway: config.auth.gateway
            ? {
                required: config.auth.gateway.required,
                apiKey: maskSecret(config.auth.gateway.apiKey),
              }
            : undefined,
          http: config.auth.http
            ? { apiKey: maskSecret(config.auth.http.apiKey) }
            : undefined,
        }
      : undefined,
  };
}
