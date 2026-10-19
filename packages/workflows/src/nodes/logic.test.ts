import { describe, it, expect } from "vitest";
import { switchExecutor } from "./logic.js";
import type { ExprContext } from "../expressions.js";
import type { NodeExecutionContext } from "../executor.js";
import type { WfNode, Workflow } from "../types.js";

function ctx(vars: Record<string, unknown> = {}): ExprContext {
  return { nodes: {}, trigger: undefined, vars, run: { id: "r1" } };
}

function node(params: Record<string, unknown>): WfNode {
  return { id: "n1", type: "switch", name: "n1", position: { x: 0, y: 0 }, params };
}

const STUB_WORKFLOW: Workflow = {
  id: "wf",
  name: "wf",
  version: 1,
  enabled: true,
  triggers: [{ id: "t1", type: "manual" }],
  nodes: [],
  edges: [],
  settings: { concurrency: "skip", timeoutMs: 60_000, allowRemoteTrigger: false, misfire: "skip", misfireGraceMs: 900_000 },
};

function execCtx(params: Record<string, unknown>, vars: Record<string, unknown> = {}): NodeExecutionContext {
  return { node: node(params), params, exprCtx: ctx(vars), signal: new AbortController().signal, workflow: STUB_WORKFLOW, nodeExecutors: {} };
}

describe("switchExecutor", () => {
  it("fires the first matching case", async () => {
    const result = await switchExecutor(
      execCtx(
        {
          cases: [
            { case: "a", condition: { op: "eq", left: "vars.kind", right: "a" } },
            { case: "b", condition: { op: "eq", left: "vars.kind", right: "b" } },
          ],
        },
        { kind: "b" },
      ),
    );
    expect(result).toEqual({ handle: "case:b", output: { matched: "b" } });
  });

  it("fires only the FIRST match when multiple cases would match", async () => {
    const result = await switchExecutor(
      execCtx(
        {
          cases: [
            { case: "first", condition: { op: "exists", left: "vars.kind" } },
            { case: "second", condition: { op: "eq", left: "vars.kind", right: "x" } },
          ],
        },
        { kind: "x" },
      ),
    );
    expect(result.handle).toBe("case:first");
  });

  it("falls back to \"default\" when no case matches", async () => {
    const result = await switchExecutor(execCtx({ cases: [{ case: "a", condition: { op: "eq", left: "vars.kind", right: "a" } }] }, { kind: "z" }));
    expect(result).toEqual({ handle: "default", output: { matched: null } });
  });

  it("falls back to \"default\" with an empty cases array", async () => {
    const result = await switchExecutor(execCtx({ cases: [] }));
    expect(result.handle).toBe("default");
  });

  it("throws when `cases` is missing or not an array", async () => {
    await expect(switchExecutor(execCtx({}))).rejects.toThrow(/cases/);
  });
});
