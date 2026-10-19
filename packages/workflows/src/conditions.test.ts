import { describe, it, expect } from "vitest";
import { evaluateCondition } from "./conditions.js";
import type { ExprContext } from "./expressions.js";
import type { Condition } from "./types.js";

const ctx: ExprContext = {
  nodes: { a: { output: { status: "ok", count: 5, tags: ["x", "y"] } } },
  trigger: undefined,
  vars: {},
  run: { id: "r1" },
};

describe("evaluateCondition", () => {
  it("eq / neq", () => {
    expect(evaluateCondition({ op: "eq", left: "nodes.a.output.status", right: "ok" }, ctx)).toBe(true);
    expect(evaluateCondition({ op: "eq", left: "nodes.a.output.status", right: "fail" }, ctx)).toBe(false);
    expect(evaluateCondition({ op: "neq", left: "nodes.a.output.status", right: "fail" }, ctx)).toBe(true);
  });

  it("gt / lt", () => {
    expect(evaluateCondition({ op: "gt", left: "nodes.a.output.count", right: 3 }, ctx)).toBe(true);
    expect(evaluateCondition({ op: "lt", left: "nodes.a.output.count", right: 3 }, ctx)).toBe(false);
  });

  it("contains — string and array", () => {
    expect(evaluateCondition({ op: "contains", left: "nodes.a.output.status", right: "o" }, ctx)).toBe(true);
    expect(evaluateCondition({ op: "contains", left: "nodes.a.output.tags", right: "y" }, ctx)).toBe(true);
    expect(evaluateCondition({ op: "contains", left: "nodes.a.output.tags", right: "z" }, ctx)).toBe(false);
  });

  it("exists", () => {
    expect(evaluateCondition({ op: "exists", left: "nodes.a.output.status" }, ctx)).toBe(true);
    expect(evaluateCondition({ op: "exists", left: "nodes.a.output.missing" }, ctx)).toBe(false);
  });

  it("matches (regex)", () => {
    expect(evaluateCondition({ op: "matches", left: "nodes.a.output.status", right: "^ok$" }, ctx)).toBe(true);
    expect(evaluateCondition({ op: "matches", left: "nodes.a.output.status", right: "^fail$" }, ctx)).toBe(false);
  });

  it("all / any / not compose", () => {
    const c: Condition = {
      all: [
        { op: "eq", left: "nodes.a.output.status", right: "ok" },
        { any: [{ op: "gt", left: "nodes.a.output.count", right: 10 }, { op: "gt", left: "nodes.a.output.count", right: 1 }] },
      ],
    };
    expect(evaluateCondition(c, ctx)).toBe(true);
    expect(evaluateCondition({ not: { op: "eq", left: "nodes.a.output.status", right: "ok" } }, ctx)).toBe(false);
  });

  it("fails closed on an unrecognized op instead of throwing or matching", () => {
    const bogus = { op: "bogus", left: "nodes.a.output.status" } as unknown as Condition;
    expect(evaluateCondition(bogus, ctx)).toBe(false);
  });
});
