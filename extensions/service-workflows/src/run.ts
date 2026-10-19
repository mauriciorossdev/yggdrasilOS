import { computeGraphHash, runWorkflow, validateWorkflow, type ExecutorEvent, type Grant, type Run, type Workflow } from "@yggdrasil/workflows";
import type { EventBus } from "@yggdrasil/sdk";
import { KNOWN_NODE_TYPES, NODE_EXECUTORS, riskLevelForNode } from "./nodeTypes.js";
import type { WorkflowStore } from "./store.js";
import { isAutomationPaused } from "./killSwitch.js";

/** `{nodeId, tool, riskLevel}` for every node in the workflow whose type isn't `safe` — what a grant needs to cover (workflows-design.md §6.2), and what GrantDialog previews. */
export function computeRiskyNodes(workflow: Workflow): { nodeId: string; tool: string; riskLevel: "moderate" | "destructive" }[] {
  const risky: { nodeId: string; tool: string; riskLevel: "moderate" | "destructive" }[] = [];
  for (const node of workflow.nodes) {
    const riskLevel = riskLevelForNode(node);
    if (riskLevel !== "safe") risky.push({ nodeId: node.id, tool: node.type, riskLevel });
  }
  return risky;
}

export type GrantStatus = "not_required" | "none" | "stale" | "granted";

/** What `workflows.list` and the UI's grant badge show — see §6.2's preflight. */
export function grantStatusFor(workflow: Workflow, grant: Grant | undefined, graphHash: string): GrantStatus {
  if (computeRiskyNodes(workflow).length === 0) return "not_required";
  if (!grant) return "none";
  return grant.graphHash === graphHash ? "granted" : "stale";
}

/**
 * Shared by every trigger source (workflows.run, the scheduler, event
 * triggers, the webhook route) so they all get the exact same validation,
 * concurrency handling, event forwarding and persistence — see
 * notes/automation/workflows-design.md §5.7 and §5.9.
 */

/** A run's AbortController, keyed by run id, only while it's in flight — lets workflows.cancel reach a run started from anywhere. */
export const activeRuns = new Map<string, AbortController>();

/** Workflow ids with a run currently in flight — backs `settings.concurrency: "skip"`. */
const runningWorkflowIds = new Set<string>();

export function isWorkflowRunning(workflowId: string): boolean {
  return runningWorkflowIds.has(workflowId);
}

export type ExecuteWorkflowRunResult =
  | { ok: true; run: Run }
  | { ok: false; reason: "automation_paused" | "concurrency_skip" | "invalid_workflow" | "grant_required"; message?: string };

export async function executeWorkflowRun(params: {
  workflow: Workflow;
  trigger: Run["trigger"];
  store: WorkflowStore;
  events: EventBus;
}): Promise<ExecuteWorkflowRunResult> {
  const { workflow, trigger, store, events } = params;

  // The kill switch is the very first preflight check (workflows-design.md
  // §6.2's diagram) — it blocks EVERY trigger source, including a manual
  // "Run" click, since it's meant as a blanket "stop all automations" switch.
  if (await isAutomationPaused()) {
    return { ok: false, reason: "automation_paused" };
  }

  const errors = validateWorkflow(workflow, KNOWN_NODE_TYPES);
  if (errors.length > 0) {
    return { ok: false, reason: "invalid_workflow", message: errors.map((e) => `${e.path}: ${e.message}`).join("; ") };
  }

  const graphHash = computeGraphHash(workflow);
  const riskyNodes = computeRiskyNodes(workflow);
  if (riskyNodes.length > 0) {
    const grant = await store.getGrant(workflow.id);
    if (!grant || grant.graphHash !== graphHash) {
      return { ok: false, reason: "grant_required", message: `${riskyNodes.length} node(s) need a grant matching the current workflow before this can run` };
    }
  }

  // "skip" (the default) means: if a run for this workflow is already in
  // flight, a new trigger is dropped rather than queued or run in parallel —
  // otherwise an unattended schedule/event/webhook trigger could pile up
  // overlapping runs of the same workflow indefinitely.
  if (workflow.settings.concurrency === "skip" && runningWorkflowIds.has(workflow.id)) {
    return { ok: false, reason: "concurrency_skip" };
  }

  runningWorkflowIds.add(workflow.id);
  const controller = new AbortController();

  // runWorkflow mints its own run id (executor.ts) — captured off the first
  // event rather than pre-allocated here, so workflows.cancel's id and every
  // workflow.*.started/finished event's id are the exact same one a client
  // just saw, not a second id it never learns about.
  let liveRunId: string | undefined;
  const forwardEvent = (event: ExecutorEvent) => {
    if (event.type === "run.started" && !liveRunId) {
      liveRunId = event.runId;
      activeRuns.set(liveRunId, controller);
    }
    const base = { runId: event.runId, workflowId: workflow.id };
    switch (event.type) {
      case "run.started":
        void events.emit("workflow.run.started", base);
        break;
      case "node.started":
        void events.emit("workflow.node.started", { ...base, nodeId: event.nodeId, attempt: event.attempt });
        break;
      case "node.finished":
        void events.emit("workflow.node.finished", { ...base, nodeId: event.nodeId, status: event.status, handle: event.handle });
        break;
      case "run.finished":
        void events.emit("workflow.run.finished", { ...base, status: event.status });
        break;
    }
  };

  let run: Run;
  try {
    run = await runWorkflow({
      workflow,
      trigger,
      nodeExecutors: NODE_EXECUTORS,
      vars: workflow.vars,
      signal: controller.signal,
      onEvent: forwardEvent,
      // The real broadcast EventBus for this run — lets `phone.tool` reach a
      // live WS-connected device (see executor.ts's own doc comment on
      // RunWorkflowOptions.deviceEvents for why this can't just be the
      // plugin-registration-time `api.events` closure instead).
      deviceEvents: events,
    });
  } finally {
    if (liveRunId) activeRuns.delete(liveRunId);
    runningWorkflowIds.delete(workflow.id);
  }

  run = { ...run, graphHash };
  await store.saveRun(run);
  return { ok: true, run };
}
