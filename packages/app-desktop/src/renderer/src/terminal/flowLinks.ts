/**
 * Renderer-memory-only map from a live pane's leaf id to the Agent Flow
 * node it was spawned from, plus its outgoing edges resolved to live
 * target leaf ids. Rebuilt from scratch every "Load into Terminal" (see
 * AgentFlowView.loadIntoTerminal) — AgentFlowNode ids are stable but pane
 * leaf ids are freshly generated each load, so this can't be persisted;
 * it's always consistent because leaves and this map are built together
 * in the same call. Empty/stale after an app restart until the flow is
 * loaded again — deliberate, not a bug.
 */
import type { AgentFlow } from "../types.js";

export type FlowLink = {
  nodeId: string;
  name: string;
  targets: { leafId: string; name: string }[];
};

/**
 * Pure builder shared by AgentFlowView's "Load into Terminal" (fresh
 * leaf ids) and TerminalContainer's rehydrate-on-restart path (leaf ids
 * recovered from terminal-layout.json's persisted `flowNodeId` field).
 */
export function buildFlowLinks(
  flow: AgentFlow,
  nodeIdToLeafId: Map<string, string>,
): Array<{ leafId: string } & FlowLink> {
  const result: Array<{ leafId: string } & FlowLink> = [];
  for (const node of flow.nodes) {
    const leafId = nodeIdToLeafId.get(node.id);
    if (!leafId) continue;
    const targets: { leafId: string; name: string }[] = [];
    for (const edge of flow.edges) {
      if (edge.from !== node.id) continue;
      const targetLeafId = nodeIdToLeafId.get(edge.to);
      if (!targetLeafId) continue;
      targets.push({ leafId: targetLeafId, name: flow.nodes.find((n) => n.id === edge.to)?.name ?? "?" });
    }
    result.push({ leafId, nodeId: node.id, name: node.name, targets });
  }
  return result;
}

const links = new Map<string, FlowLink>();

export function setFlowLinks(entries: Array<{ leafId: string } & FlowLink>): void {
  links.clear();
  for (const entry of entries) {
    const { leafId, ...link } = entry;
    links.set(leafId, link);
  }
}

export function getFlowLink(leafId: string): FlowLink | undefined {
  return links.get(leafId);
}
