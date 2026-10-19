import type { WfEdge, Workflow } from "./types.js";
import { bfsForward } from "./loopGraph.js";

export type ValidationError = { path: string; message: string };

/**
 * Structural validation only (shape, references, cycles) — a node's own
 * `params` are validated against its type's JSON schema by the caller
 * (workflows.nodeTypes / the node's own executor registration), not here,
 * since this package doesn't know what node types exist beyond their name.
 */
export function validateWorkflow(workflow: Workflow, knownNodeTypes: ReadonlySet<string>): ValidationError[] {
  const errors: ValidationError[] = [];

  if (workflow.nodes.length === 0) errors.push({ path: "nodes", message: "workflow has no nodes" });
  if (workflow.triggers.length === 0) errors.push({ path: "triggers", message: "workflow has no triggers" });

  const seenIds = new Set<string>();
  for (const node of workflow.nodes) {
    if (seenIds.has(node.id)) errors.push({ path: `nodes.${node.id}`, message: "duplicate node id" });
    seenIds.add(node.id);
    if (!knownNodeTypes.has(node.type)) errors.push({ path: `nodes.${node.id}`, message: `unknown node type "${node.type}"` });
  }

  const nodeIds = new Set(workflow.nodes.map((n) => n.id));
  const seenEdgeIds = new Set<string>();
  for (const edge of workflow.edges) {
    if (seenEdgeIds.has(edge.id)) errors.push({ path: `edges.${edge.id}`, message: "duplicate edge id" });
    seenEdgeIds.add(edge.id);
    if (!nodeIds.has(edge.from)) errors.push({ path: `edges.${edge.id}`, message: `edge references unknown "from" node "${edge.from}"` });
    if (!nodeIds.has(edge.to)) errors.push({ path: `edges.${edge.id}`, message: `edge references unknown "to" node "${edge.to}"` });
  }

  if (errors.length === 0 && hasCycle(workflow)) {
    // `loop` never needs an edge-level cycle — its repetition happens by
    // nodes/loop.ts calling runWorkflow() again per item, not by looping
    // back through an edge — so this stays an unconditional error.
    errors.push({ path: "edges", message: "workflow graph contains a cycle" });
  }

  if (errors.length === 0) errors.push(...validateLoopNodes(workflow));

  return errors;
}

/**
 * `loop` (workflows-design.md §4/§5.4) needs its body to be a real subgraph,
 * not just another branch — validated here rather than left to blow up at
 * runtime:
 *   - exactly one outgoing "each" edge, to the subgraph's single root node;
 *   - every node the loop's body reaches must be reachable ONLY through
 *     that root (never from outside the loop, and never shared with
 *     another loop's body) — otherwise a node's run state would be
 *     ambiguous between "ran once in the main graph" and "ran once per
 *     iteration";
 *   - `params.resultNodeId` must name a node inside that same subgraph —
 *     required as a literal (workflows-design.md's Fase 5 design decision:
 *     an explicit result node, not an inferred single "sink", since a body
 *     with branching has no single unambiguous sink).
 */
function validateLoopNodes(workflow: Workflow): ValidationError[] {
  const errors: ValidationError[] = [];
  const loopNodes = workflow.nodes.filter((n) => n.type === "loop");
  if (loopNodes.length === 0) return errors;

  const outgoing = new Map<string, WfEdge[]>();
  for (const edge of workflow.edges) {
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge);
    outgoing.set(edge.from, list);
  }
  const allNodeIds = workflow.nodes.map((n) => n.id);
  const subgraphs = new Map<string, Set<string>>();

  for (const loopNode of loopNodes) {
    const eachEdges = (outgoing.get(loopNode.id) ?? []).filter((e) => e.fromHandle === "each");
    if (eachEdges.length !== 1) {
      errors.push({ path: `nodes.${loopNode.id}`, message: `loop node must have exactly one outgoing "each" edge (found ${eachEdges.length})` });
      continue;
    }

    const root = eachEdges[0]!.to;
    const subgraph = bfsForward(root, outgoing);

    const outsideStarts = allNodeIds.filter((id) => id !== loopNode.id && !subgraph.has(id));
    let leaked: string | undefined;
    for (const start of outsideStarts) {
      for (const id of bfsForward(start, outgoing)) {
        if (subgraph.has(id)) {
          leaked = id;
          break;
        }
      }
      if (leaked) break;
    }
    if (leaked) {
      errors.push({ path: `nodes.${loopNode.id}`, message: `node "${leaked}" is reachable both inside and outside this loop's body — a loop body must only be reachable through its own "each" edge` });
      continue;
    }

    subgraphs.set(loopNode.id, subgraph);

    const resultNodeId = loopNode.params.resultNodeId;
    if (typeof resultNodeId !== "string" || !resultNodeId) {
      errors.push({ path: `nodes.${loopNode.id}`, message: "loop node requires a `resultNodeId` param naming the body node whose output becomes each iteration's result" });
    } else if (!subgraph.has(resultNodeId)) {
      errors.push({ path: `nodes.${loopNode.id}`, message: `resultNodeId "${resultNodeId}" is not a node inside this loop's body` });
    }
  }

  const seenElsewhere = new Map<string, string>();
  for (const [loopId, subgraph] of subgraphs) {
    for (const nodeId of subgraph) {
      const owner = seenElsewhere.get(nodeId);
      if (owner && owner !== loopId) {
        errors.push({ path: `nodes.${nodeId}`, message: `node belongs to more than one loop's body ("${owner}" and "${loopId}")` });
      } else {
        seenElsewhere.set(nodeId, loopId);
      }
    }
  }

  return errors;
}

function hasCycle(workflow: Workflow): boolean {
  const adjacency = new Map<string, string[]>();
  for (const edge of workflow.edges) {
    const list = adjacency.get(edge.from) ?? [];
    list.push(edge.to);
    adjacency.set(edge.from, list);
  }

  const UNVISITED = 0;
  const IN_PROGRESS = 1;
  const DONE = 2;
  const color = new Map<string, number>();

  function visit(id: string): boolean {
    color.set(id, IN_PROGRESS);
    for (const next of adjacency.get(id) ?? []) {
      const state = color.get(next) ?? UNVISITED;
      if (state === IN_PROGRESS) return true;
      if (state === UNVISITED && visit(next)) return true;
    }
    color.set(id, DONE);
    return false;
  }

  for (const node of workflow.nodes) {
    if ((color.get(node.id) ?? UNVISITED) === UNVISITED && visit(node.id)) return true;
  }
  return false;
}
