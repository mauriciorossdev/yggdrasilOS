import { describe, it, expect } from "vitest";
import { validateWorkflow } from "./validate.js";
import type { Workflow } from "./types.js";

const KNOWN = new Set(["set", "if", "delay", "loop"]);

function workflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: "wf1",
    name: "Test",
    version: 1,
    enabled: true,
    triggers: [{ id: "t1", type: "manual" }],
    nodes: [
      { id: "a", type: "set", name: "A", position: { x: 0, y: 0 }, params: { name: "x", value: 1 } },
      { id: "b", type: "set", name: "B", position: { x: 100, y: 0 }, params: { name: "y", value: 2 } },
    ],
    edges: [{ id: "e1", from: "a", fromHandle: "out", to: "b" }],
    settings: { concurrency: "skip", timeoutMs: 600_000, allowRemoteTrigger: false, misfire: "skip", misfireGraceMs: 900_000 },
    ...overrides,
  };
}

describe("validateWorkflow", () => {
  it("accepts a valid linear workflow", () => {
    expect(validateWorkflow(workflow(), KNOWN)).toEqual([]);
  });

  it("rejects a workflow with no nodes", () => {
    const errors = validateWorkflow(workflow({ nodes: [], edges: [] }), KNOWN);
    expect(errors.some((e) => e.path === "nodes")).toBe(true);
  });

  it("rejects a workflow with no triggers", () => {
    const errors = validateWorkflow(workflow({ triggers: [] }), KNOWN);
    expect(errors.some((e) => e.path === "triggers")).toBe(true);
  });

  it("rejects an unknown node type", () => {
    const wf = workflow();
    wf.nodes[0]!.type = "desktop.screenshot";
    const errors = validateWorkflow(wf, KNOWN);
    expect(errors.some((e) => e.message.includes("unknown node type"))).toBe(true);
  });

  it("rejects a duplicate node id", () => {
    const wf = workflow();
    wf.nodes[1]!.id = "a";
    const errors = validateWorkflow(wf, KNOWN);
    expect(errors.some((e) => e.message.includes("duplicate node id"))).toBe(true);
  });

  it("rejects an edge referencing an unknown node", () => {
    const wf = workflow({ edges: [{ id: "e1", from: "a", fromHandle: "out", to: "ghost" }] });
    const errors = validateWorkflow(wf, KNOWN);
    expect(errors.some((e) => e.message.includes('unknown "to" node'))).toBe(true);
  });

  it("rejects a cycle", () => {
    const wf = workflow({
      nodes: [
        { id: "a", type: "set", name: "A", position: { x: 0, y: 0 }, params: {} },
        { id: "b", type: "set", name: "B", position: { x: 0, y: 0 }, params: {} },
      ],
      edges: [
        { id: "e1", from: "a", fromHandle: "out", to: "b" },
        { id: "e2", from: "b", fromHandle: "out", to: "a" },
      ],
    });
    const errors = validateWorkflow(wf, KNOWN);
    expect(errors.some((e) => e.message.includes("cycle"))).toBe(true);
  });

  it("accepts branching (if -> true/false to different nodes) without flagging a cycle", () => {
    const wf = workflow({
      nodes: [
        { id: "cond", type: "if", name: "Cond", position: { x: 0, y: 0 }, params: { condition: { op: "exists", left: "vars.x" } } },
        { id: "a", type: "set", name: "A", position: { x: 0, y: 0 }, params: { name: "x", value: 1 } },
        { id: "b", type: "set", name: "B", position: { x: 0, y: 0 }, params: { name: "y", value: 2 } },
      ],
      edges: [
        { id: "e1", from: "cond", fromHandle: "true", to: "a" },
        { id: "e2", from: "cond", fromHandle: "false", to: "b" },
      ],
    });
    expect(validateWorkflow(wf, KNOWN)).toEqual([]);
  });
});

describe("validateWorkflow — loop nodes", () => {
  function loopWorkflow(overrides: Partial<Workflow> = {}): Workflow {
    return workflow({
      nodes: [
        { id: "lp", type: "loop", name: "Loop", position: { x: 0, y: 0 }, params: { items: [1, 2, 3], resultNodeId: "body" } },
        { id: "body", type: "set", name: "Body", position: { x: 100, y: 0 }, params: { name: "x", value: 1 } },
        { id: "after", type: "set", name: "After", position: { x: 200, y: 0 }, params: { name: "y", value: 2 } },
      ],
      edges: [
        { id: "e1", from: "lp", fromHandle: "each", to: "body" },
        { id: "e2", from: "lp", fromHandle: "done", to: "after" },
      ],
      ...overrides,
    });
  }

  it("accepts a valid single-node loop body", () => {
    expect(validateWorkflow(loopWorkflow(), KNOWN)).toEqual([]);
  });

  it("accepts a multi-node loop body (branching inside, still exclusive to the loop)", () => {
    const wf = loopWorkflow({
      nodes: [
        { id: "lp", type: "loop", name: "Loop", position: { x: 0, y: 0 }, params: { items: [1], resultNodeId: "b2" } },
        { id: "b1", type: "if", name: "B1", position: { x: 0, y: 0 }, params: { condition: { op: "exists", left: "loop.item" } } },
        { id: "b2", type: "set", name: "B2", position: { x: 0, y: 0 }, params: { name: "x", value: 1 } },
      ],
      edges: [
        { id: "e1", from: "lp", fromHandle: "each", to: "b1" },
        { id: "e2", from: "b1", fromHandle: "true", to: "b2" },
      ],
    });
    expect(validateWorkflow(wf, KNOWN)).toEqual([]);
  });

  it("rejects a loop node with no \"each\" edge", () => {
    const wf = loopWorkflow({ edges: [{ id: "e2", from: "lp", fromHandle: "done", to: "after" }] });
    const errors = validateWorkflow(wf, KNOWN);
    expect(errors.some((e) => e.message.includes('exactly one outgoing "each" edge'))).toBe(true);
  });

  it("rejects a loop node with two \"each\" edges", () => {
    const wf = loopWorkflow({
      nodes: [...loopWorkflow().nodes, { id: "body2", type: "set", name: "Body2", position: { x: 0, y: 0 }, params: { name: "z", value: 1 } }],
      edges: [...loopWorkflow().edges, { id: "e3", from: "lp", fromHandle: "each", to: "body2" }],
    });
    const errors = validateWorkflow(wf, KNOWN);
    expect(errors.some((e) => e.message.includes('exactly one outgoing "each" edge'))).toBe(true);
  });

  it("rejects a body node that's also reachable from outside the loop", () => {
    const wf = loopWorkflow({
      edges: [
        { id: "e1", from: "lp", fromHandle: "each", to: "body" },
        { id: "e2", from: "lp", fromHandle: "done", to: "after" },
        { id: "e3", from: "after", fromHandle: "out", to: "body" }, // leaks "body" in from outside the loop
      ],
    });
    const errors = validateWorkflow(wf, KNOWN);
    expect(errors.some((e) => e.message.includes("reachable both inside and outside"))).toBe(true);
  });

  it("rejects a missing resultNodeId", () => {
    const wf = loopWorkflow();
    wf.nodes[0]!.params = { items: [1], resultNodeId: undefined };
    const errors = validateWorkflow(wf, KNOWN);
    expect(errors.some((e) => e.message.includes("resultNodeId"))).toBe(true);
  });

  it("rejects a resultNodeId that isn't inside the loop's own body", () => {
    const wf = loopWorkflow();
    wf.nodes[0]!.params = { items: [1], resultNodeId: "after" }; // "after" is outside the loop
    const errors = validateWorkflow(wf, KNOWN);
    expect(errors.some((e) => e.message.includes('not a node inside this loop'))).toBe(true);
  });

  it("rejects two loops whose bodies share a node", () => {
    const wf: Workflow = {
      ...loopWorkflow(),
      nodes: [
        { id: "lp1", type: "loop", name: "L1", position: { x: 0, y: 0 }, params: { items: [1], resultNodeId: "shared" } },
        { id: "lp2", type: "loop", name: "L2", position: { x: 0, y: 0 }, params: { items: [1], resultNodeId: "shared" } },
        { id: "shared", type: "set", name: "Shared", position: { x: 0, y: 0 }, params: { name: "x", value: 1 } },
      ],
      edges: [
        { id: "e1", from: "lp1", fromHandle: "each", to: "shared" },
        { id: "e2", from: "lp2", fromHandle: "each", to: "shared" },
      ],
    };
    const errors = validateWorkflow(wf, KNOWN);
    // Both loops reach "shared" independently — from lp1's perspective, lp2
    // is an "outside" starting point that also reaches it (and vice versa),
    // so this is actually caught by the exclusivity (leak) check first.
    expect(errors.length).toBeGreaterThan(0);
  });
});
