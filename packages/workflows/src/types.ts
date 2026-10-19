// Mirrors notes/automation/workflows-design.md §3. This package only
// implements the generic engine (validate/hash/expressions/executor) plus
// the "logic" node types (if/set/delay) — desktop/phone/agent/http node
// types land in later phases (see the design doc's §10.1 phase table) and
// are registered from outside this package via `NodeExecutor` (executor.ts).

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
  /** Values may contain `{{expr}}` placeholders — see expressions.ts. */
  params: Record<string, unknown>;
  retry?: { max: number; backoffMs: number };
  timeoutMs?: number;
  /** Default "fail" — see executor.ts. */
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
  artifacts: ArtifactRef[];
};

export type ArtifactRef = {
  id: string;
  mime: string;
  path: string;
  bytes: number;
  meta?: { width?: number; height?: number; suspectBlank?: boolean };
};
