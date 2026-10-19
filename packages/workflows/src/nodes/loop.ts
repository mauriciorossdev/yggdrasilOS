import { runWorkflow, type NodeExecutor } from "../executor.js";
import { computeLoopSubgraph, extractSubWorkflow } from "../loopGraph.js";
import type { Workflow } from "../types.js";

// workflows-design.md §4: "Cap de 100 iteraciones; si se pasa, el nodo falla con loop_limit."
const MAX_ITERATIONS = 100;

/**
 * `loop` — iterates `params.items` (an array), running the subgraph attached
 * to its "each" edge once per item, in sequence, then fires "done" with
 * `output = { results }` (one entry per item, taken from the body node named
 * by `params.resultNodeId` — see validate.ts's validateLoopNodes for why
 * that's an explicit param rather than an inferred sink).
 *
 * Implemented as just another NodeExecutor that recursively calls
 * runWorkflow() on the subgraph — no changes to the engine's own DAG-walking
 * loop were needed, since executor.ts already wraps every node (this one
 * included) with its own timeout/retry/cancellation/onError. The subgraph's
 * per-iteration node states are NOT surfaced in the outer Run.nodes map
 * (that stays one entry per node per run) — they're nested inside this
 * node's own `output.iterations`, each with its own mini nodes map, exactly
 * like a normal Run's `nodes` field.
 */
export const loopExecutor: NodeExecutor = async ({ node, params, exprCtx, signal, workflow, nodeExecutors, deviceEvents }) => {
  const items = params.items;
  if (!Array.isArray(items)) throw new Error("loop node requires an `items` param that resolves to an array");
  if (items.length > MAX_ITERATIONS) throw new Error(`loop_limit: ${items.length} items exceeds the ${MAX_ITERATIONS}-iteration cap`);

  const resultNodeId = typeof params.resultNodeId === "string" ? params.resultNodeId : "";
  if (!resultNodeId) throw new Error("loop node requires a `resultNodeId` param");

  const subgraph = computeLoopSubgraph(workflow, node.id);
  if (!subgraph.nodeIds.has(resultNodeId)) {
    throw new Error(`loop node's resultNodeId "${resultNodeId}" is not part of its own body`);
  }
  const sub = extractSubWorkflow(workflow, subgraph, node.id);

  const results: unknown[] = [];
  const iterations: { item: unknown; index: number; status: string; nodes: unknown }[] = [];

  for (let index = 0; index < items.length; index++) {
    if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("aborted");

    const item: unknown = items[index];
    const subWorkflow: Workflow = {
      id: sub.id,
      name: `${node.name} [${index}]`,
      version: 1,
      enabled: true,
      triggers: [{ id: "loop", type: "manual" }],
      nodes: sub.nodes,
      edges: sub.edges,
      settings: workflow.settings,
    };

    // Same live `vars` object as the outer run (not a copy — see
    // executor.ts's own comment on why that's safe) so a `set` node inside
    // the body accumulates across iterations; seeded with the outer run's
    // node outputs so far so the body can reference `{{ nodes.<id>.output }}`
    // from before the loop, same as anywhere else in the workflow.
    const iterationRun = await runWorkflow({
      workflow: subWorkflow,
      trigger: { id: "loop", type: "manual" },
      nodeExecutors,
      vars: exprCtx.vars,
      signal,
      loopContext: { item, index },
      seedNodeOutputs: exprCtx.nodes,
      deviceEvents,
    });

    iterations.push({ item, index, status: iterationRun.status, nodes: iterationRun.nodes });

    if (iterationRun.status !== "succeeded") {
      if (iterationRun.status === "cancelled") throw new Error("aborted");
      const failedNodeId = iterationRun.error?.nodeId;
      throw new Error(`loop iteration ${index} failed${failedNodeId ? ` (node "${failedNodeId}")` : ""}: ${iterationRun.error?.message ?? iterationRun.status}`);
    }

    results.push(iterationRun.nodes[resultNodeId]?.output);
  }

  return { handle: "done", output: { results, iterations } };
};
