import { describe, it, expect } from "vitest";
import { KNOWN_NODE_TYPES, NODE_EXECUTORS, riskLevelForNode, riskLevelForNodeType } from "./nodeTypes.js";

describe("riskLevelForNodeType", () => {
  it("is safe for the logic node types", () => {
    expect(riskLevelForNodeType("if")).toBe("safe");
    expect(riskLevelForNodeType("set")).toBe("safe");
    expect(riskLevelForNodeType("delay")).toBe("safe");
    expect(riskLevelForNodeType("switch")).toBe("safe");
  });

  it("defaults an unknown type to destructive", () => {
    expect(riskLevelForNodeType("something.made.up")).toBe("destructive");
  });
});

describe("riskLevelForNode (param-aware)", () => {
  it("http.request with GET (or no method) is safe", () => {
    expect(riskLevelForNode({ type: "http.request", params: {} })).toBe("safe");
    expect(riskLevelForNode({ type: "http.request", params: { method: "GET" } })).toBe("safe");
    expect(riskLevelForNode({ type: "http.request", params: { method: "get" } })).toBe("safe");
  });

  it("http.request with any other method is moderate", () => {
    expect(riskLevelForNode({ type: "http.request", params: { method: "POST" } })).toBe("moderate");
    expect(riskLevelForNode({ type: "http.request", params: { method: "DELETE" } })).toBe("moderate");
  });

  it("http.request with an unresolved {{ }} expression for method fails closed to moderate", () => {
    expect(riskLevelForNode({ type: "http.request", params: { method: "{{ vars.method }}" } })).toBe("moderate");
  });

  it("phone.tool looks up risk per `tool` from the real device-tool risk table", () => {
    expect(riskLevelForNode({ type: "phone.tool", params: { tool: "phone_open_app" } })).toBe("safe");
    expect(riskLevelForNode({ type: "phone.tool", params: { tool: "phone_set_alarm" } })).toBe("moderate");
  });

  it("phone.tool fails closed to destructive for an unknown or missing tool name", () => {
    expect(riskLevelForNode({ type: "phone.tool", params: { tool: "phone_nonexistent_tool" } })).toBe("destructive");
    expect(riskLevelForNode({ type: "phone.tool", params: {} })).toBe("destructive");
  });

  it("falls back to the type-level risk for every other node type", () => {
    expect(riskLevelForNode({ type: "if", params: {} })).toBe("safe");
    expect(riskLevelForNode({ type: "unknown.thing", params: {} })).toBe("destructive");
  });
});

describe("node type / executor consistency", () => {
  it("every known node type has a registered executor", () => {
    for (const type of KNOWN_NODE_TYPES) {
      expect(NODE_EXECUTORS[type], `missing executor for "${type}"`).toBeTypeOf("function");
    }
  });
});
