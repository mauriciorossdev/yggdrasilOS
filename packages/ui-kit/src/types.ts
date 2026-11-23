// Gateway shapes used by the kit's components; app-desktop's types.ts re-exports them.

export type ChatDeltaPayload = {
  sessionKey: string;
  text: string;
};

export type ChatFinalPayload = {
  sessionKey: string;
  text: string;
  harnessId: string;
  usage?: { inputTokens?: number; outputTokens?: number };
};

export type TurnEndPayload = {
  sessionKey: string;
  classification: "ok" | "error" | "retry" | "fallback";
  durationMs: number;
};

export type ToolExecutePayload = {
  sessionKey: string;
  toolName: string;
  status: "running" | "ok" | "error";
  args?: Record<string, unknown>;
  result?: string;
  error?: string;
  image?: { base64: string; mimeType: string; path?: string };
};

export type ToolApprovalRequestedPayload = {
  requestId: string;
  sessionKey: string;
  toolName: string;
  args: Record<string, unknown>;
  riskLevel?: "destructive" | "moderate" | "safe";
  /** The requesting connection's registered device id, when known — see gateway's requireFsApproval. Lets ApprovalBar offer "trust this device" instead of just "approve this one call". */
  deviceId?: string;
};

export type ToolApprovalResolvedPayload = {
  requestId: string;
  sessionKey: string;
  toolName: string;
  approved: boolean;
};

export type ApprovalMode = "auto" | "plan" | "restrict" | "yolo";

export type ApprovalModeChangedPayload = {
  sessionKey: string;
  mode: ApprovalMode;
};

export type AgentInfo = {
  id: string;
  label?: string;
  model?: string;
  provider?: string;
  /** Harness id when the agent doesn't go through a provider (e.g. "builtin-echo"). */
  harness?: string;
  systemPrompt?: string;
  /** Omitted = every tool; `{ allow: [] }` = no tools at all. Patterns may use `*`. */
  tools?: { allow?: string[] };
  scope?: "local" | "global";
};

export type CreateAgentResult = {
  ok: true;
  agent: AgentInfo;
};

export type GetAgentResult = { agent: AgentInfo };

export type ProviderModelInfo = {
  id: string;
  label: string;
  provider: string;
  contextWindow?: number;
  supportsTools?: boolean;
};

export type ProviderInfo = {
  id: string;
  label: string;
  models: ProviderModelInfo[];
  /** Authenticates with an API key (set in config or env). */
  needsKey?: boolean;
  /** Ready to use: has its key (or needs none). */
  configured?: boolean;
  error?: string;
};

export type SessionInfo = {
  sessionKey: string;
  title?: string;
  messageCount: number;
  updatedAt: number;
};

export type ConfigAgent = { id: string; label?: string; provider?: string; model?: string };

export type ConfigProvider = { baseUrl?: string; apiKey?: string; defaultModel?: string };

// env/headers are intentionally absent here — sanitizeConfigForClient strips
// them from every config.get response (see packages/config/src/sanitize.ts),
// so this shape only ever carries the non-secret fields. Secrets are edited
// write-only via McpSection's mcpSecretEdits, mirroring apiKeyEdits.
export type ConfigMcpServer =
  | { transport: "stdio"; command?: string; args?: string[]; autoStart?: boolean }
  | { transport: "http"; url?: string; autoStart?: boolean };

export type ConfigShape = {
  agents?: ConfigAgent[];
  defaultAgent?: string;
  language?: string;
  harness?: { policy?: string; pinnedId?: string };
  channels?: Record<string, { enabled?: boolean }>;
  providers?: Record<string, ConfigProvider>;
  mcpServers?: Record<string, ConfigMcpServer>;
};

/** Where each provider field's value comes from (notes/features/global-providers.md). */
export type ProviderFieldSource = "default" | "global" | "project" | "env";

export type ProviderSources = Record<string, Partial<Record<keyof ConfigProvider, ProviderFieldSource>>>;

export type ConfigGetResult = {
  config: ConfigShape;
  providerSources?: ProviderSources;
  workspaceRoot: string | null;
  configPath: string | null;
};

// Mirrors main/roles.ts's CustomRole — same "main and renderer keep separate
// copies" convention as WhisperSettings/SttSettings above.
export type CustomRole = {
  id: string;
  label: string;
  summary?: string;
  systemPrompt: string;
};
