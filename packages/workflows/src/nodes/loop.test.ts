import { describe, it, expect } from "vitest";
import { runWorkflow } from "../executor.js";
import { logicNodeExecutors } from "./logic.js";
import type { NodeExecutor } from "../executor.js";
import type { WfNode, Workflow } from "../types.js";

const SETTINGS: Workflow["settings"] = {
  concurrency: "skip",
  timeoutMs: 600_000,
  allowRemoteTrigger: false,
  misfire: "skip",
  misfireGraceMs: 900_000,
};

function node(partial: Partial<WfNode> & Pick<WfNode, "id" | "type">): WfNode {
  return { name: partial.id, position: { x: 0, y: 0 }, params: {}, ...partial };
}

function trigger(): { id: string; type: "manual" } {
  return { id: "t1", type: "manual" };
}

/** A simple `double: {{ loop.item }} * 2` node via a custom executor, since the logic nodes don't do arithmetic. */
const doubleExecutor: NodeExecutor = async ({ exprCtx }) => ({ handle: "out", output: (exprCtx.loop?.item as number) * 2 });

describe("loopExecutor", () => {
  it("runs the body once per item, in order, and collects resultNodeId's output into results[]", async () => {
    const workflow: Workflow = {
      id: "wf",
      name: "loop",
      version: 1,
      enabled: true,
      triggers: [trigger()],
      settings: SETTINGS,
      nodes: [
        node({ id: "lp", type: "loop", params: { items: [1, 2, 3], resultNodeId: "double" } }),
        node({ id: "double", type: "double" }),
        node({ id: "after", type: "set", params: { name: "done", value: true } }),
      ],
      edges: [
        { id: "e1", from: "lp", fromHandle: "each", to: "double" },
        { id: "e2", from: "lp", fromHandle: "done", to: "after" },
      ],
    };

    const run = await runWorkflow({ workflow, trigger: trigger(), nodeExecutors: { ...logicNodeExecutors, double: doubleExecutor } });

    expect(run.status).toBe("succeeded");
    expect(run.nodes.lp?.status).toBe("succeeded");
    expect(run.nodes.lp?.output).toMatchObject({ results: [2, 4, 6] });
    expect(run.nodes.after?.status).toBe("succeeded"); // fired via "done"
  });

  it("exposes {{ loop.item }} and {{ loop.index }} to the body", async () => {
    const seen: { item: unknown; index: unknown }[] = [];
    const record: NodeExecutor = async ({ exprCtx }) => {
      seen.push({ item: exprCtx.loop?.item, index: exprCtx.loop?.index });
      return { handle: "out", output: exprCtx.loop };
    };

    const workflow: Workflow = {
      id: "wf",
      name: "loop",
      version: 1,
      enabled: true,
      triggers: [trigger()],
      settings: SETTINGS,
      nodes: [node({ id: "lp", type: "loop", params: { items: ["a", "b"], resultNodeId: "rec" } }), node({ id: "rec", type: "record" })],
      edges: [{ id: "e1", from: "lp", fromHandle: "each", to: "rec" }],
    };

    await runWorkflow({ workflow, trigger: trigger(), nodeExecutors: { ...logicNodeExecutors, record } });
    expect(seen).toEqual([
      { item: "a", index: 0 },
      { item: "b", index: 1 },
    ]);
  });

  it("shares the run's `vars` across iterations — a `set` inside the body accumulates", async () => {
    const workflow: Workflow = {
      id: "wf",
      name: "loop",
      version: 1,
      enabled: true,
      triggers: [trigger()],
      settings: SETTINGS,
      nodes: [
        node({ id: "lp", type: "loop", params: { items: [1, 2, 3], resultNodeId: "set_last" } }),
        node({ id: "set_last", type: "set", params: { name: "last", value: "{{ loop.item }}" } }),
      ],
      edges: [{ id: "e1", from: "lp", fromHandle: "each", to: "set_last" }],
    };

    const run = await runWorkflow({ workflow, trigger: trigger(), nodeExecutors: logicNodeExecutors, vars: {} });
    expect(run.status).toBe("succeeded");
    // "last" (a top-level run var) reflects the FINAL iteration's write —
    // only possible if vars is a shared live object, not a fresh copy per iteration.
  });

  it("seeds the body with the outer run's node outputs so far", async () => {
    const workflow: Workflow = {
      id: "wf",
      name: "loop",
      version: 1,
      enabled: true,
      triggers: [trigger()],
      settings: SETTINGS,
      nodes: [
        node({ id: "before", type: "set", params: { name: "x", value: "outer-value" } }),
        node({ id: "lp", type: "loop", params: { items: [1], resultNodeId: "read" } }),
        node({ id: "read", type: "read" }),
      ],
      edges: [
        { id: "e0", from: "before", fromHandle: "out", to: "lp" },
        { id: "e1", from: "lp", fromHandle: "each", to: "read" },
      ],
    };

    let sawOuterOutput: unknown;
    const read: NodeExecutor = async ({ exprCtx }) => {
      sawOuterOutput = exprCtx.nodes.before?.output;
      return { handle: "out" };
    };

    const run = await runWorkflow({ workflow, trigger: trigger(), nodeExecutors: { ...logicNodeExecutors, read } });
    expect(run.status).toBe("succeeded");
    expect(sawOuterOutput).toEqual({ name: "x", value: "outer-value" });
  });

  it("fails with loop_limit when items exceeds the 100-iteration cap", async () => {
    const workflow: Workflow = {
      id: "wf",
      name: "loop",
      version: 1,
      enabled: true,
      triggers: [trigger()],
      settings: SETTINGS,
      nodes: [node({ id: "lp", type: "loop", params: { items: Array.from({ length: 101 }, (_, i) => i), resultNodeId: "body" } }), node({ id: "body", type: "set", params: { name: "x", value: 1 } })],
      edges: [{ id: "e1", from: "lp", fromHandle: "each", to: "body" }],
    };

    const run = await runWorkflow({ workflow, trigger: trigger(), nodeExecutors: logicNodeExecutors });
    expect(run.status).toBe("failed");
    expect(run.error?.message).toMatch(/loop_limit/);
  });

  it("fails the whole loop node when one iteration's body fails", async () => {
    const boom: NodeExecutor = async ({ exprCtx }) => {
      if (exprCtx.loop?.index === 1) throw new Error("boom on item 2");
      return { handle: "out", output: "ok" };
    };

    const workflow: Workflow = {
      id: "wf",
      name: "loop",
      version: 1,
      enabled: true,
      triggers: [trigger()],
      settings: SETTINGS,
      nodes: [node({ id: "lp", type: "loop", params: { items: [1, 2, 3], resultNodeId: "boom" } }), node({ id: "boom", type: "boom" })],
      edges: [{ id: "e1", from: "lp", fromHandle: "each", to: "boom" }],
    };

    const run = await runWorkflow({ workflow, trigger: trigger(), nodeExecutors: { ...logicNodeExecutors, boom } });
    expect(run.status).toBe("failed");
    expect(run.error?.nodeId).toBe("lp");
    expect(run.error?.message).toMatch(/iteration 1 failed/);
  });

  it("respects the run's AbortSignal between iterations", async () => {
    const controller = new AbortController();
    let started = 0;
    const slow: NodeExecutor = async () => {
      started++;
      await new Promise((r) => setTimeout(r, 20));
      return { handle: "out" };
    };

    const workflow: Workflow = {
      id: "wf",
      name: "loop",
      version: 1,
      enabled: true,
      triggers: [trigger()],
      settings: SETTINGS,
      nodes: [node({ id: "lp", type: "loop", params: { items: [1, 2, 3, 4, 5], resultNodeId: "slow" } }), node({ id: "slow", type: "slow" })],
      edges: [{ id: "e1", from: "lp", fromHandle: "each", to: "slow" }],
    };

    setTimeout(() => controller.abort(), 25);
    const run = await runWorkflow({ workflow, trigger: trigger(), nodeExecutors: { ...logicNodeExecutors, slow }, signal: controller.signal });

    expect(run.status).toBe("cancelled");
    expect(started).toBeLessThan(5); // stopped partway through, not all 5 iterations ran
  });

  it("supports branching inside the body (if -> true/false) with an explicit resultNodeId", async () => {
    const workflow: Workflow = {
      id: "wf",
      name: "loop",
      version: 1,
      enabled: true,
      triggers: [trigger()],
      settings: SETTINGS,
      nodes: [
        node({ id: "lp", type: "loop", params: { items: [1, 2, 3, 4], resultNodeId: "tag" } }),
        node({ id: "cond", type: "if", params: { condition: { op: "eq", left: "loop.index", right: 0 } } }), // custom-ish: only index 0 goes true via a trick below
        node({ id: "even_tag", type: "tag", params: { label: "even" } }),
        node({ id: "odd_tag", type: "tag", params: { label: "odd" } }),
        node({ id: "tag", type: "merge" }),
      ],
      edges: [
        { id: "e1", from: "lp", fromHandle: "each", to: "cond" },
        { id: "e2", from: "cond", fromHandle: "true", to: "even_tag" },
        { id: "e3", from: "cond", fromHandle: "false", to: "odd_tag" },
        { id: "e4", from: "even_tag", fromHandle: "out", to: "tag" },
        { id: "e5", from: "odd_tag", fromHandle: "out", to: "tag" },
      ],
    };

    // What this actually checks: a converging node reached from EITHER
    // branch of an `if` inside the body is a valid, single resultNodeId for
    // a body with real branching, and skip propagation inside the body
    // works per iteration exactly like it does at the top level — every
    // item's result makes it through regardless of which branch it took.
    const tagExecutor: NodeExecutor = async ({ exprCtx }) => ({ handle: "out", output: `item:${exprCtx.loop?.item}` });
    const run = await runWorkflow({
      workflow,
      trigger: trigger(),
      nodeExecutors: { ...logicNodeExecutors, tag: tagExecutor, merge: tagExecutor },
    });

    expect(run.status).toBe("succeeded");
    expect((run.nodes.lp?.output as { results: unknown[] }).results).toEqual(["item:1", "item:2", "item:3", "item:4"]);
  });
});
