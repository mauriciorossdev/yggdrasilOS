import { randomUUID } from "node:crypto";
import type { Run, RunStatus, WfEdge, WfNode, Workflow } from "./types.js";
import { resolveParams, type ExprContext } from "./expressions.js";

export type NodeExecutionContext = {
  node: WfNode;
  /** node.params with every `{{ }}` placeholder already resolved. */
  params: Record<string, unknown>;
  exprCtx: ExprContext;
  signal: AbortSignal;
  /** The full workflow this node belongs to — unused by ordinary leaf executors, but `loop`'s executor (nodes/loop.ts) needs it to find its own subgraph's nodes/edges. */
  workflow: Workflow;
  /** Same map the outer runWorkflow() call was given — unused by ordinary leaf executors, but `loop` needs it to run its subgraph's own nodes (if/http.request/agent.ask/a nested loop/...) through a recursive runWorkflow() call. */
  nodeExecutors: Record<string, NodeExecutor>;
  /**
   * Opaque passthrough of RunWorkflowOptions.deviceEvents — this package
   * stays IO-agnostic (no @yggdrasil/gateway dependency), so it's typed
   * `unknown` here. Only extensions/service-workflows's `phone.tool` node
   * (which does depend on @yggdrasil/gateway) knows the real shape and
   * casts it when calling getDeviceToolInvoker()'s invoke function — see
   * that package's nodes/phoneTool.ts.
   */
  deviceEvents?: unknown;
};

export type NodeResult = { handle: string; output?: unknown };

export type NodeExecutor = (ctx: NodeExecutionContext) => Promise<NodeResult>;

export type ExecutorEvent =
  | { type: "run.started"; runId: string }
  | { type: "node.started"; runId: string; nodeId: string; attempt: number }
  | { type: "node.finished"; runId: string; nodeId: string; status: "succeeded" | "failed" | "skipped"; handle?: string }
  | { type: "run.finished"; runId: string; status: RunStatus };

export type RunWorkflowOptions = {
  workflow: Workflow;
  trigger: Run["trigger"];
  /** Node type -> implementation. Types with no registered executor fail the node (onError still applies) rather than crashing the whole engine — lets phase 2 ship without desktop/phone/agent/http node types existing yet. */
  nodeExecutors: Record<string, NodeExecutor>;
  vars?: Record<string, unknown>;
  signal?: AbortSignal;
  /** Default 4 — workflows-design.md §5.3. */
  maxParallel?: number;
  onEvent?: (event: ExecutorEvent) => void;
  /**
   * Set only for a `loop` node's per-item nested call (nodes/loop.ts) —
   * exposed to the subgraph's nodes as `{{ loop.item }}`/`{{ loop.index }}`.
   * Absent for a normal top-level run.
   */
  loopContext?: { item: unknown; index: number };
  /**
   * Set only for a `loop` node's nested call — seeds the subgraph's node
   * outputs with the outer run's so far, so a loop body can reference
   * `{{ nodes.<id-from-before-the-loop>.output }}` like any other node.
   * Copied in, never mutated back out (the subgraph's own node outputs stay
   * local to that one iteration).
   */
  seedNodeOutputs?: Record<string, { output?: unknown }>;
  /**
   * The real gateway EventBus for this run, opaque to this package — threaded
   * down into NodeExecutionContext.deviceEvents so a node executor like
   * `phone.tool` (extensions/service-workflows) can reach a live WS-connected
   * device. Without this, a node that needs to emit something a connected
   * client will actually receive has no way to get at the process's real
   * broadcast bus (the plugin-registration-time `api.events` a node type's
   * module captures at load time is a DIFFERENT, non-broadcast EventBus
   * instance — see packages/kernel/src/plugin-loader.ts's own `loadPlugins`,
   * which mints its own bus rather than reusing the gateway's).
   */
  deviceEvents?: unknown;
};

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_PARALLEL = 4;

function nowIso(): string {
  return new Date().toISOString();
}

function toErrorInfo(err: unknown): { code: string; message: string } {
  if (err instanceof Error) return { code: err.name === "Error" ? "error" : err.name, message: err.message };
  return { code: "error", message: String(err) };
}

function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(abortReason(signal));
      return;
    }
    signal.addEventListener("abort", () => reject(abortReason(signal)), { once: true });
  });
}

function abortReason(signal: AbortSignal): Error {
  const reason = (signal as AbortSignal & { reason?: unknown }).reason;
  return reason instanceof Error ? reason : new Error("aborted");
}

/** Runs one attempt of a node, racing it against the run signal + this node's own timeout — even a non-cooperative executor that ignores `signal` still gets treated as failed/cancelled by the engine once the race settles. */
async function runOneAttempt(
  executor: NodeExecutor,
  baseCtx: Omit<NodeExecutionContext, "signal">,
  timeoutMs: number,
  runSignal: AbortSignal | undefined,
): Promise<{ result?: NodeResult; error?: Error; runCancelled: boolean }> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combined = runSignal ? AbortSignal.any([runSignal, timeoutSignal]) : timeoutSignal;

  try {
    const result = await Promise.race([executor({ ...baseCtx, signal: combined }), waitForAbort(combined)]);
    return { result, runCancelled: false };
  } catch (err) {
    return { error: err instanceof Error ? err : new Error(String(err)), runCancelled: !!runSignal?.aborted };
  }
}

/**
 * Walks the workflow's DAG to completion — see workflows-design.md §5 for
 * the full semantics this implements: ready-queue ordering, skip
 * propagation through unreached branches, retries with backoff, per-node
 * timeouts, bounded parallelism, and cooperative cancellation.
 */
export async function runWorkflow(options: RunWorkflowOptions): Promise<Run> {
  const { workflow, trigger, nodeExecutors, onEvent } = options;
  const maxParallel = options.maxParallel ?? DEFAULT_MAX_PARALLEL;
  const runId = randomUUID();
  const startedAt = nowIso();

  const nodesById = new Map(workflow.nodes.map((n) => [n.id, n]));
  const outgoing = new Map<string, WfEdge[]>();
  const incoming = new Map<string, WfEdge[]>();
  for (const edge of workflow.edges) {
    (outgoing.get(edge.from) ?? outgoing.set(edge.from, []).get(edge.from)!).push(edge);
    (incoming.get(edge.to) ?? incoming.set(edge.to, []).get(edge.to)!).push(edge);
  }

  const edgeActive = new Map<string, boolean>();
  const nodeState: Run["nodes"] = {};
  for (const node of workflow.nodes) nodeState[node.id] = { status: "pending", attempts: 0 };

  const nodeOutputs: Record<string, { output?: unknown }> = { ...options.seedNodeOutputs };
  // Not copied (unlike nodeOutputs above): a loop body's nested runWorkflow
  // call passes the SAME live vars object the outer run already holds
  // (nodes/loop.ts hands it its own exprCtx.vars), so a `set` node inside
  // the loop body mutates it directly — an accumulator across iterations,
  // same as any other node's `set` already does within one run. Safe to
  // stop defensively copying here because every caller (run.ts) already
  // hands in a freshly JSON.parse'd `workflow.vars`, never a shared
  // long-lived object across separate runs.
  const vars: Record<string, unknown> = options.vars ?? {};

  let runStatus: RunStatus = "running";
  let runError: Run["error"];
  let cancelled = false;

  const ready: string[] = [];
  const inFlight = new Map<string, Promise<void>>();

  for (const node of workflow.nodes) {
    if ((incoming.get(node.id) ?? []).length === 0) ready.push(node.id);
  }

  onEvent?.({ type: "run.started", runId });

  function isNodeSettleable(nodeId: string): boolean {
    return (incoming.get(nodeId) ?? []).every((e) => edgeActive.has(e.id));
  }

  function settleOutgoing(nodeId: string, activeHandle: string | undefined): void {
    for (const edge of outgoing.get(nodeId) ?? []) {
      edgeActive.set(edge.id, activeHandle !== undefined && edge.fromHandle === activeHandle);
    }
    // A downstream node may now have every incoming edge settled — recheck
    // every node once rather than tracking a precise dependency count, since
    // workflow graphs are small (dozens of nodes at most) and this keeps the
    // scheduler simple and easy to verify against the design doc's spec.
    for (const candidate of workflow.nodes) {
      if (nodeState[candidate.id]!.status !== "pending") continue;
      if (ready.includes(candidate.id) || inFlight.has(candidate.id)) continue;
      if ((incoming.get(candidate.id) ?? []).length === 0) continue; // already seeded
      if (isNodeSettleable(candidate.id)) ready.push(candidate.id);
    }
  }

  function markSkipped(nodeId: string): void {
    nodeState[nodeId] = { ...nodeState[nodeId]!, status: "skipped", startedAt: nowIso(), endedAt: nowIso() };
    onEvent?.({ type: "node.finished", runId, nodeId, status: "skipped" });
    settleOutgoing(nodeId, undefined);
  }

  async function runNode(nodeId: string): Promise<void> {
    const node = nodesById.get(nodeId)!;
    const hasIncoming = (incoming.get(nodeId) ?? []).length > 0;
    if (hasIncoming && !(incoming.get(nodeId) ?? []).some((e) => edgeActive.get(e.id))) {
      markSkipped(nodeId);
      return;
    }

    const exprCtx: ExprContext = { nodes: nodeOutputs, trigger: trigger.payload, vars, run: { id: runId }, loop: options.loopContext };
    const executor = nodeExecutors[node.type];
    const maxAttempts = (node.retry?.max ?? 0) + 1;
    const timeoutMs = node.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    nodeState[nodeId] = { ...nodeState[nodeId]!, status: "running", startedAt: nowIso() };

    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (cancelled) return;
      onEvent?.({ type: "node.started", runId, nodeId, attempt });
      nodeState[nodeId]!.attempts = attempt;

      if (!executor) {
        lastError = new Error(`no executor registered for node type "${node.type}"`);
        break;
      }

      const params = resolveParams(node.params, exprCtx);
      const attemptResult = await runOneAttempt(
        executor,
        { node, params, exprCtx, workflow, nodeExecutors, deviceEvents: options.deviceEvents },
        timeoutMs,
        options.signal,
      );

      if (attemptResult.result) {
        nodeOutputs[nodeId] = { output: attemptResult.result.output };
        nodeState[nodeId] = {
          ...nodeState[nodeId]!,
          status: "succeeded",
          endedAt: nowIso(),
          output: attemptResult.result.output,
        };
        onEvent?.({ type: "node.finished", runId, nodeId, status: "succeeded", handle: attemptResult.result.handle });
        settleOutgoing(nodeId, attemptResult.result.handle);
        return;
      }

      lastError = attemptResult.error;
      if (attemptResult.runCancelled) {
        cancelled = true;
        return;
      }
      if (attempt < maxAttempts && node.retry) {
        await new Promise((resolve) => setTimeout(resolve, node.retry!.backoffMs * 2 ** (attempt - 1)));
      }
    }

    // Every attempt failed (or the node type has no executor at all).
    const errorInfo = toErrorInfo(lastError ?? new Error("unknown node failure"));
    const onError = node.onError ?? "fail";

    if (onError === "fail") {
      nodeState[nodeId] = { ...nodeState[nodeId]!, status: "failed", endedAt: nowIso(), error: errorInfo };
      onEvent?.({ type: "node.finished", runId, nodeId, status: "failed" });
      runStatus = "failed";
      runError = { ...errorInfo, nodeId };
      cancelled = true; // stop scheduling further nodes; in-flight ones still get awaited below
      return;
    }

    const handle = onError === "errorBranch" ? "error" : "out";
    nodeOutputs[nodeId] = { output: { error: errorInfo } };
    nodeState[nodeId] = { ...nodeState[nodeId]!, status: "failed", endedAt: nowIso(), error: errorInfo, output: { error: errorInfo } };
    onEvent?.({ type: "node.finished", runId, nodeId, status: "failed", handle });
    settleOutgoing(nodeId, handle);
  }

  while ((ready.length > 0 || inFlight.size > 0) && !cancelled) {
    while (ready.length > 0 && inFlight.size < maxParallel && !cancelled) {
      const nodeId = ready.shift()!;
      const promise = runNode(nodeId).finally(() => inFlight.delete(nodeId));
      inFlight.set(nodeId, promise);
    }
    if (inFlight.size === 0) break;
    await Promise.race(inFlight.values());
  }

  // A run.signal cancellation (vs. a node onError:"fail") can leave nodes
  // mid-flight — wait them out so the returned Run never has a node stuck at
  // "running" with no endedAt.
  if (inFlight.size > 0) await Promise.allSettled(inFlight.values());

  if (runStatus === "running") {
    runStatus = options.signal?.aborted ? "cancelled" : "succeeded";
  }

  onEvent?.({ type: "run.finished", runId, status: runStatus });

  return {
    id: runId,
    workflowId: workflow.id,
    graphHash: "", // filled in by the caller, which already has computeGraphHash's input — see extensions/service-workflows
    trigger,
    status: runStatus,
    startedAt,
    endedAt: nowIso(),
    error: runError,
    nodes: nodeState,
    artifacts: [],
  };
}
