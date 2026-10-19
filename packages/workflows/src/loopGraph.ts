import type { WfEdge, WfNode, Workflow } from "./types.js";

/**
 * Shared by validate.ts (structural checks at save time) and nodes/loop.ts
 * (actually building the sub-workflow at run time) — a `loop` node's body is
 * every node reachable from its single "each" edge, and nothing else
 * (workflows-design.md §4/§5.4). See validate.ts's validateLoopNodes doc
 * comment for why exclusivity/resultNodeId are enforced.
 */
export type LoopSubgraph = { rootId: string; nodeIds: Set<string> };

function buildOutgoingMap(edges: WfEdge[]): Map<string, WfEdge[]> {
  const outgoing = new Map<string, WfEdge[]>();
  for (const edge of edges) {
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge);
    outgoing.set(edge.from, list);
  }
  return outgoing;
}

export function bfsForward(start: string, outgoing: Map<string, WfEdge[]>): Set<string> {
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const edge of outgoing.get(id) ?? []) queue.push(edge.to);
  }
  return seen;
}

/** Only call this on a workflow that already passed validateWorkflow — throws otherwise, same posture as a node executor's own required-param checks. */
export function computeLoopSubgraph(workflow: Workflow, loopNodeId: string): LoopSubgraph {
  const outgoing = buildOutgoingMap(workflow.edges);
  const eachEdges = (outgoing.get(loopNodeId) ?? []).filter((e) => e.fromHandle === "each");
  if (eachEdges.length !== 1) {
    throw new Error(`loop node "${loopNodeId}" must have exactly one outgoing "each" edge (found ${eachEdges.length}) — this workflow wasn't validated`);
  }
  const rootId = eachEdges[0]!.to;
  return { rootId, nodeIds: bfsForward(rootId, outgoing) };
}

/** The subgraph's own nodes + only the edges that run strictly between them (an edge from a subgraph node back out, if any slipped past validation, is dropped rather than followed). */
export function extractSubWorkflow(workflow: Workflow, subgraph: LoopSubgraph, idSuffix: string): Pick<Workflow, "nodes" | "edges"> & { id: string } {
  const nodes: WfNode[] = workflow.nodes.filter((n) => subgraph.nodeIds.has(n.id));
  const edges: WfEdge[] = workflow.edges.filter((e) => subgraph.nodeIds.has(e.from) && subgraph.nodeIds.has(e.to));
  return { id: `${workflow.id}:${idSuffix}`, nodes, edges };
}
