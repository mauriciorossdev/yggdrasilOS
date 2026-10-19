// Structurally mirrors @yggdrasil/sdk's EventBus (on/emit/off) without
// importing it — sdk/src/harness.ts already imports ToolRiskLevel from this
// package, so importing EventBus back here would create a cycle. A real
// EventBus is structurally assignable to this type, and vice versa, so it
// can be passed straight through into APIs (e.g. runChannelTurn) typed with
// the real EventBus.
export type ToolEventBus = {
  on<T = unknown>(event: string, handler: (payload: T) => void | Promise<void>): () => void;
  emit<T = unknown>(event: string, payload: T): Promise<void>;
  off(event: string, handler: (payload: unknown) => void | Promise<void>): void;
};

export type ToolContext = {
  sessionKey: string;
  config: unknown;
  workspaceRoot?: string;
  metadata?: Record<string, unknown>;
  events?: ToolEventBus;
};

// A JSON Schema object describing a tool's arguments. Kept loose (not the
// narrower { type, description } shape it used to be) so it can also carry
// an MCP tool's inputSchema verbatim — those routinely use enum/array/nested
// properties this type previously couldn't express, even though nothing
// downstream (toolsToOpenAI et al.) does anything but pass it through as-is.
export type ToolParameterSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
};

export type ToolRiskLevel = "safe" | "moderate" | "destructive";

export type ApprovalMode = "auto" | "plan" | "restrict" | "yolo";

export type AgentToolDefinition = {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
  requiresApproval?: boolean;
  riskLevel?: ToolRiskLevel;
  /**
   * Optional per-call risk classifier. When present, it fully decides whether
   * this specific invocation needs approval (based on the actual args), taking
   * over from the static `riskLevel`/`requiresApproval` fields entirely — those
   * still act as the fallback for any code path that doesn't call assessRisk.
   * Must fail closed: an ambiguous/unrecognized invocation should return
   * "destructive", not "safe".
   */
  assessRisk?: (args: Record<string, unknown>) => ToolRiskLevel;
  execute(ctx: ToolContext, args: Record<string, unknown>): Promise<unknown>;
  /**
   * Set only for tools backed by a remote device connection (gateway
   * device-tools protocol) — "sync" (short fixed timeout, no human in the
   * loop on the device) vs "interactive" (device shows a system picker/
   * dialog, long safety-ceiling timeout instead). Absent for ordinary
   * server-side tools.
   */
  kind?: "sync" | "interactive";
};

export function defineTool(def: AgentToolDefinition): AgentToolDefinition {
  if ((def.riskLevel === "destructive" || def.riskLevel === "moderate") && def.requiresApproval !== false) {
    return { ...def, requiresApproval: true };
  }
  return def;
}
