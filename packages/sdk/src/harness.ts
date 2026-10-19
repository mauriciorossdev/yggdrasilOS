export type ConfigSchema = {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type PluginLogger = {
  debug: (msg: string, meta?: Record<string, unknown>) => void;
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
};

export type EventHandler<T = unknown> = (payload: T) => void | Promise<void>;

export type EventBus = {
  on<T = unknown>(event: string, handler: EventHandler<T>): () => void;
  emit<T = unknown>(event: string, payload: T): Promise<void>;
  off(event: string, handler: EventHandler): void;
};

export type HarnessSupportContext = {
  provider: string;
  modelId?: string;
  runtime?: string;
};

export type HarnessSupport =
  | { supported: true; priority?: number; reason?: string }
  | { supported: false; reason?: string };

import type { ChatMessage } from "./provider.js";
import type { ApprovalMode, ToolRiskLevel } from "@yggdrasil/tools-sdk";

export type ToolApprovalRequest = {
  sessionKey: string;
  toolName: string;
  args: Record<string, unknown>;
  riskLevel?: ToolRiskLevel;
  /** The requesting connection's registered device id (see gateway's deviceIdByConnectionId), when known — lets the approval UI offer "trust this device" instead of just "approve this one call". Undefined for the desktop app's own loopback connection, or any connection that never registered a device. */
  deviceId?: string;
};

export type ToolApprovalHandler = (
  request: ToolApprovalRequest,
) => Promise<boolean>;

export type HarnessAttemptParams = {
  sessionKey: string;
  sessionId?: string;
  provider: string;
  modelId?: string;
  message: string;
  history?: ChatMessage[];
  onDelta?: (text: string) => void;
  metadata?: Record<string, unknown>;
  approveTool?: ToolApprovalHandler;
  workspaceRoot?: string;
  events?: EventBus;
  /** Per-session tool-approval mode override — see ToolLoopOptions in @yggdrasil/harness-llm. */
  approvalMode?: ApprovalMode;
};

export type HarnessAttemptResult = {
  text: string;
  usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number };
  classification?: HarnessResultClassification;
  metadata?: Record<string, unknown>;
  /** Intermediate tool-loop messages (assistant+tool), excluding the final assistant reply. */
  sessionAppend?: ChatMessage[];
};

export type HarnessCompactParams = {
  sessionKey: string;
  sessionId?: string;
  reason?: string;
};

export type HarnessCompactResult = {
  compacted: boolean;
  summary?: string;
};

export type HarnessResetParams = {
  sessionId?: string;
  sessionKey?: string;
  reason?: "new" | "reset" | "idle" | "unknown";
};

export type HarnessResultClassification = "ok" | "error" | "retry" | "fallback";

export type AgentHarness = {
  id: string;
  label: string;
  pluginId?: string;
  supports(ctx: HarnessSupportContext): HarnessSupport;
  runAttempt(params: HarnessAttemptParams): Promise<HarnessAttemptResult>;
  classify?(
    result: HarnessAttemptResult,
    ctx: HarnessAttemptParams,
  ): HarnessResultClassification | undefined;
  compact?(params: HarnessCompactParams): Promise<HarnessCompactResult | undefined>;
  reset?(params: HarnessResetParams): Promise<void> | void;
  dispose?(): Promise<void> | void;
};

export type RegisteredAgentHarness = {
  harness: AgentHarness;
  ownerPluginId?: string;
};
