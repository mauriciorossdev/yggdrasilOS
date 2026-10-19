import { describe, it, expect } from "vitest";
import { resolveExpression, resolveParams, resolvePath, type ExprContext } from "./expressions.js";

function ctx(overrides: Partial<ExprContext> = {}): ExprContext {
  return {
    nodes: { a: { output: { text: "hello", n: 42, nested: { deep: "value" } } } },
    trigger: { payload: { foo: "bar" } },
    vars: { count: 3 },
    run: { id: "run-1" },
    ...overrides,
  };
}

describe("resolvePath", () => {
  it("resolves nested node output paths", () => {
    expect(resolvePath("nodes.a.output.text", ctx())).toBe("hello");
    expect(resolvePath("nodes.a.output.nested.deep", ctx())).toBe("value");
  });

  it("resolves vars and run paths", () => {
    expect(resolvePath("vars.count", ctx())).toBe(3);
    expect(resolvePath("run.id", ctx())).toBe("run-1");
  });

  it("returns undefined for a path that doesn't exist", () => {
    expect(resolvePath("nodes.missing.output.x", ctx())).toBeUndefined();
    expect(resolvePath("vars.nope", ctx())).toBeUndefined();
  });

  it("returns undefined for an unknown root", () => {
    expect(resolvePath("bogus.thing", ctx())).toBeUndefined();
  });
});

describe("resolveExpression", () => {
  it("preserves the real type when the whole string is a single expression", () => {
    expect(resolveExpression("{{ nodes.a.output.n }}", ctx())).toBe(42);
    expect(resolveExpression("{{ nodes.a.output.nested }}", ctx())).toEqual({ deep: "value" });
  });

  it("stringifies into mixed text", () => {
    expect(resolveExpression("count is {{ vars.count }}!", ctx())).toBe("count is 3!");
  });

  it("renders a missing path as empty string inside mixed text", () => {
    expect(resolveExpression("value: {{ vars.missing }}.", ctx())).toBe("value: .");
  });

  it("JSON-stringifies an object/array resolved inside mixed text, instead of collapsing to \"[object Object]\"", () => {
    // Real bug found live: an http.request's JSON body interpolated into an
    // agent.ask prompt ("...this JSON: {{ nodes.a.output.body }}") produced
    // the literal text "[object Object]" via plain String(), making the
    // whole prompt meaningless to the model.
    expect(resolveExpression("data: {{ nodes.a.output.nested }}", ctx())).toBe('data: {"deep":"value"}');
    expect(resolveExpression("list: {{ vars.items }}", ctx({ vars: { items: [1, 2, 3] } }))).toBe("list: [1,2,3]");
  });

  it("passes through a plain string with no expression untouched", () => {
    expect(resolveExpression("just text", ctx())).toBe("just text");
  });

  it("passes through non-string values untouched", () => {
    expect(resolveExpression(42, ctx())).toBe(42);
    expect(resolveExpression(null, ctx())).toBeNull();
    const obj = { a: 1 };
    expect(resolveExpression(obj, ctx())).toBe(obj);
  });

  it("never evaluates arbitrary code — a non-path-shaped expression body resolves to undefined, not a runtime error or a code execution", () => {
    // {{ }} only matches [a-zA-Z0-9_.]+ — anything else (parens, operators,
    // quotes) simply isn't recognized as an expression at all, by design.
    expect(resolveExpression("{{ 1 + 1 }}", ctx())).toBe("{{ 1 + 1 }}");
  });
});

describe("resolveParams", () => {
  it("resolves every string leaf, including inside nested arrays/objects", () => {
    const resolved = resolveParams(
      {
        title: "Result: {{ nodes.a.output.text }}",
        raw: "{{ nodes.a.output.n }}",
        nested: { list: ["{{ vars.count }}", "literal"] },
      },
      ctx(),
    );
    expect(resolved).toEqual({
      title: "Result: hello",
      raw: 42,
      nested: { list: [3, "literal"] },
    });
  });
});
