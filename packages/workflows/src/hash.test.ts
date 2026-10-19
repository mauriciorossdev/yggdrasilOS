import { describe, it, expect } from "vitest";
import { computeGraphHash } from "./hash.js";
import type { Workflow } from "./types.js";

function baseWorkflow(): Pick<Workflow, "triggers" | "nodes" | "edges"> {
  return {
    triggers: [{ id: "t1", type: "manual" }],
    nodes: [
      { id: "a", type: "set", name: "A", position: { x: 0, y: 0 }, params: { name: "x", value: 1 } },
      { id: "b", type: "set", name: "B", position: { x: 100, y: 0 }, params: { name: "y", value: 2 } },
    ],
    edges: [{ id: "e1", from: "a", fromHandle: "out", to: "b" }],
  };
}

describe("computeGraphHash", () => {
  it("is stable across repeated calls on the same workflow", () => {
    const wf = baseWorkflow();
    expect(computeGraphHash(wf)).toBe(computeGraphHash(wf));
  });

  it("does not change when a node is renamed or moved on the canvas", () => {
    const wf = baseWorkflow();
    const before = computeGraphHash(wf);
    wf.nodes[0]!.name = "Renamed";
    wf.nodes[0]!.position = { x: 999, y: 999 };
    expect(computeGraphHash(wf)).toBe(before);
  });

  it("changes when a node param changes", () => {
    const wf = baseWorkflow();
    const before = computeGraphHash(wf);
    wf.nodes[0]!.params = { name: "x", value: 999 };
    expect(computeGraphHash(wf)).not.toBe(before);
  });

  it("changes when an edge changes", () => {
    const wf = baseWorkflow();
    const before = computeGraphHash(wf);
    wf.edges[0]!.fromHandle = "true";
    expect(computeGraphHash(wf)).not.toBe(before);
  });

  it("changes when a trigger changes", () => {
    const wf = baseWorkflow();
    const before = computeGraphHash(wf);
    wf.triggers = [{ id: "t1", type: "schedule", cron: "0 8 * * *" }];
    expect(computeGraphHash(wf)).not.toBe(before);
  });

  it("is order-independent for object key ordering (canonical JSON)", () => {
    const a = computeGraphHash({
      triggers: [],
      edges: [],
      nodes: [{ id: "a", type: "set", name: "A", position: { x: 0, y: 0 }, params: { name: "x", value: 1 } }],
    });
    const b = computeGraphHash({
      triggers: [],
      edges: [],
      nodes: [{ id: "a", type: "set", name: "A", position: { x: 0, y: 0 }, params: { value: 1, name: "x" } }],
    });
    expect(a).toBe(b);
  });
});
