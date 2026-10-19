export type RpcRequest = {
  id: number;
  method: string;
  params: Record<string, unknown>;
};

export type RpcResponse = {
  id: number;
  result?: unknown;
  error?: { code: string; message: string };
};

export type WsEvent = {
  type: "event";
  event: string;
  payload: unknown;
};

export type WsIncoming = RpcResponse | WsEvent;

export type ChatSendParams = {
  message: string;
  channelId?: string;
  accountId?: string;
  senderId?: string;
  sessionKey?: string;
  agentId?: string;
  metadata?: Record<string, unknown>;
};

export type ChatSendResult = {
  sessionKey: string;
  reply: string;
  harnessId: string;
};

export type ChatDeltaPayload = {
  sessionKey: string;
  text: string;
  partial: true;
};

export type ChatFinalPayload = {
  sessionKey: string;
  text: string;
  harnessId: string;
  usage?: { inputTokens?: number; outputTokens?: number };
};

export type TurnStartPayload = {
  sessionKey: string;
  agentId: string;
  harnessId: string;
  messagePreview: string;
};

export type TurnEndPayload = {
  sessionKey: string;
  harnessId: string;
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
};

export type ToolApprovalRequestedPayload = {
  requestId: string;
  sessionKey: string;
  toolName: string;
  args: Record<string, unknown>;
  riskLevel?: "destructive" | "moderate" | "safe";
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
  systemPrompt?: string;
  scope?: "local" | "global";
};

export type AgentCreateParams = {
  id: string;
  label?: string;
  systemPrompt: string;
  provider?: string;
  model?: string;
  scope: "local" | "global";
};

export type AgentCreateResult = {
  ok: true;
  agent: AgentInfo;
};

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
};

export type SessionInfo = {
  sessionKey: string;
  title?: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
  agentId?: string;
  metadata?: Record<string, unknown>;
};

export type HealthResult = {
  ok: true;
  version: string;
  pluginApi: string;
  uptime: number;
  authRequired: boolean;
  ui: boolean;
  features: string[];
};

export type ConfigGetResult = {
  config: Record<string, unknown>;
  workspaceRoot: string | null;
  configPath: string | null;
};

export type ConfigPatchResult = {
  ok: true;
  path: string;
  requiresRestart: boolean;
  config: Record<string, unknown>;
};
