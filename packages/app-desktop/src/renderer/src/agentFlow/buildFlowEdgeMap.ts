import type { AgentFlow } from "../types.js";

/**
 * Adjacency map for "Run Flow": which agentIds each yggdrasil agentId is
 * allowed to invoke_agent() to, derived from the canvas's edges. Shipped as
 * chat.send's metadata.agentFlowEdges — invoke-agent-tool.ts enforces it as
 * a hard allowlist, not just a prompt-level suggestion. Only yggdrasil nodes
 * with a set agentId participate; claude/antigravity/omp/copilot nodes (no
 * gateway agentId, no programmatic hook) can never appear here, so an autonomous
 * run can never reach them.
 */
export function buildAgentFlowEdgeMap(flow: AgentFlow): Record<string, string[]> {
  const yggdrasilAgentIdByNodeId = new Map<string, string>();
  for (const node of flow.nodes) {
    if (node.harness.type === "yggdrasil" && node.harness.agentId) {
      yggdrasilAgentIdByNodeId.set(node.id, node.harness.agentId);
    }
  }

  const map: Record<string, string[]> = {};
  const push = (from: string, to: string) => {
    const list = map[from] ?? (map[from] = []);
    if (!list.includes(to)) list.push(to);
  };

  const hasIncomingEdge = new Set(
    flow.edges.filter((e) => yggdrasilAgentIdByNodeId.has(e.to)).map((e) => e.to),
  );
  if (flow.supervisor.type === "yggdrasil" && flow.supervisor.agentId) {
    for (const [nodeId, agentId] of yggdrasilAgentIdByNodeId) {
      if (!hasIncomingEdge.has(nodeId)) push(flow.supervisor.agentId, agentId);
    }
  }

  for (const edge of flow.edges) {
    const from = yggdrasilAgentIdByNodeId.get(edge.from);
    const to = yggdrasilAgentIdByNodeId.get(edge.to);
    if (from && to) push(from, to);
  }

  return map;
}
