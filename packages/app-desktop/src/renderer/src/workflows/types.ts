// Mirrors @yggdrasil/workflows's src/types.ts (and Grant, all from the same
// file) — kept as a separate local copy, same "main/renderer/backend each
// keep their own copy of the wire shape" convention as agentFlow/../types.ts
// (see e.g. IdeSettings). See notes/automation/workflows-design.md §3.

export type Trigger =
  | { id: string; type: "manual" }
  | { id: string; type: "schedule"; cron: string; timezone?: string }
  | { id: string; type: "event"; event: "fs.changed" | "workflow.run.finished" | "turn.completed"; filter?: Condition }
  | { id: string; type: "webhook"; secretRef: string; method: "POST" | "GET" }
  | { id: string; type: "mobile"; deviceId?: string };

export type NodeTarget = "gateway" | "desktop" | `phone:${string}`;

export type OnError = "fail" | "continue" | "errorBranch";

export type WfNode = {
  id: string;
  type: string;
  name: string;
  position: { x: number; y: number };
  target?: NodeTarget;
  params: Record<string, unknown>;
  retry?: { max: number; backoffMs: number };
  timeoutMs?: number;
  onError?: OnError;
};

export type EdgeHandle = "out" | "true" | "false" | "error" | "default" | "each" | "done" | `case:${string}`;

export type WfEdge = {
  id: string;
  from: string;
  fromHandle: EdgeHandle;
  to: string;
};

export type Condition =
  | { op: "eq" | "neq" | "contains" | "gt" | "lt" | "exists" | "matches"; left: string; right?: unknown }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

export type WorkflowSettings = {
  concurrency: "skip" | "queue" | "parallel";
  timeoutMs: number;
  allowRemoteTrigger: boolean;
  misfire: "skip" | "runOnce";
  misfireGraceMs: number;
};

export type Workflow = {
  id: string;
  name: string;
  version: 1;
  enabled: boolean;
  triggers: Trigger[];
  nodes: WfNode[];
  edges: WfEdge[];
  vars?: Record<string, unknown>;
  settings: WorkflowSettings;
};

export type Grant = {
  workflowId: string;
  graphHash: string;
  riskyNodes: { nodeId: string; tool: string; riskLevel: "moderate" | "destructive"; agentTools?: string[] }[];
  grantedAt: string;
  grantedBy: "desktop";
};

export type GrantStatus = "not_required" | "none" | "stale" | "granted";

export type WorkflowSummary = { workflow: Workflow; grantStatus: GrantStatus };

export type NodeRunStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";

export type NodeRunState = {
  status: NodeRunStatus;
  startedAt?: string;
  endedAt?: string;
  attempts: number;
  output?: unknown;
  error?: { code: string; message: string };
};

export type RunStatus = "running" | "succeeded" | "failed" | "cancelled" | "skipped";

export type Run = {
  id: string;
  workflowId: string;
  graphHash: string;
  trigger: { id: string; type: Trigger["type"]; payload?: unknown };
  status: RunStatus;
  startedAt: string;
  endedAt?: string;
  error?: { code: string; message: string; nodeId?: string };
  nodes: Record<string, NodeRunState>;
  artifacts: unknown[];
};

export type NodeTypeInfo = {
  type: string;
  description: string;
  target: "gateway";
  riskLevel: "safe" | "moderate" | "destructive";
  paramsSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
};

export const DEFAULT_SETTINGS: WorkflowSettings = {
  concurrency: "skip",
  timeoutMs: 600_000,
  allowRemoteTrigger: false,
  misfire: "skip",
  misfireGraceMs: 900_000,
};

/** The source handles a node exposes — renderer-local knowledge (the nodeTypes catalog doesn't declare handles), used by WorkflowFlowNode/WorkflowCanvas. `switch`'s handles are param-dependent (one per configured case), so this takes the whole node, not just its type. */
export function handlesForNode(node: { type: string; params: Record<string, unknown> }): string[] {
  if (node.type === "if") return ["true", "false"];
  if (node.type === "switch") {
    const cases = Array.isArray(node.params.cases) ? (node.params.cases as { case?: unknown }[]) : [];
    const caseHandles = cases.map((c) => `case:${String(c.case ?? "")}`).filter((h) => h !== "case:");
    return [...caseHandles, "default"];
  }
  if (node.type === "loop") return ["each", "done"];
  return ["out"];
}
