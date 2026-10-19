import { describe, it, expect } from "vitest";
import { buildAgentFlowEdgeMap } from "./buildFlowEdgeMap.js";
import type { AgentFlow } from "../types.js";

function flow(overrides: Partial<AgentFlow> = {}): AgentFlow {
  return {
    version: 1,
    name: "test",
    nodes: [],
    edges: [],
    supervisor: { type: "human" },
    updatedAt: 0,
    ...overrides,
  };
}

describe("buildAgentFlowEdgeMap", () => {
  it("maps supervisor -> root nodes -> edge-connected nodes, skipping a dangling claude node", () => {
    const f = flow({
      nodes: [
        { id: "a", name: "A", position: { x: 0, y: 0 }, harness: { type: "yggdrasil", agentId: "planner" } },
        { id: "b", name: "B", position: { x: 0, y: 0 }, harness: { type: "yggdrasil", agentId: "researcher" } },
        { id: "c", name: "C", position: { x: 0, y: 0 }, harness: { type: "claude" } },
      ],
      edges: [
        { id: "e1", from: "a", to: "b" },
        { id: "e2", from: "a", to: "c" },
      ],
      supervisor: { type: "yggdrasil", agentId: "orchestrator" },
    });

    const map = buildAgentFlowEdgeMap(f);

    expect(map).toEqual({
      orchestrator: ["planner"],
      planner: ["researcher"],
    });
  });

  it("treats every node with no incoming edge as a supervisor root", () => {
    const f = flow({
      nodes: [
        { id: "a", name: "A", position: { x: 0, y: 0 }, harness: { type: "yggdrasil", agentId: "agentA" } },
        { id: "b", name: "B", position: { x: 0, y: 0 }, harness: { type: "yggdrasil", agentId: "agentB" } },
      ],
      edges: [],
      supervisor: { type: "yggdrasil", agentId: "orchestrator" },
    });

    const map = buildAgentFlowEdgeMap(f);

    expect(map.orchestrator).toEqual(expect.arrayContaining(["agentA", "agentB"]));
    expect(map.orchestrator).toHaveLength(2);
  });

  it("returns an empty map when the supervisor isn't a yggdrasil agent", () => {
    const f = flow({
      nodes: [{ id: "a", name: "A", position: { x: 0, y: 0 }, harness: { type: "yggdrasil", agentId: "agentA" } }],
      supervisor: { type: "human" },
    });

    expect(buildAgentFlowEdgeMap(f)).toEqual({});
  });

  it("ignores edges touching non-yggdrasil or agentId-less nodes", () => {
    const f = flow({
      nodes: [
        { id: "a", name: "A", position: { x: 0, y: 0 }, harness: { type: "yggdrasil", agentId: "agentA" } },
        { id: "b", name: "B", position: { x: 0, y: 0 }, harness: { type: "yggdrasil", agentId: "" } },
        { id: "c", name: "C", position: { x: 0, y: 0 }, harness: { type: "antigravity" } },
      ],
      edges: [
        { id: "e1", from: "a", to: "b" },
        { id: "e2", from: "a", to: "c" },
      ],
      supervisor: { type: "yggdrasil", agentId: "orchestrator" },
    });

    const map = buildAgentFlowEdgeMap(f);
    // "a" has no incoming edge, so it's still a supervisor root; "b"/"c"
    // never resolve to a usable agentId, so no edge from "a" is recorded.
    expect(map).toEqual({ orchestrator: ["agentA"] });
  });
});
