import { describe, it, expect } from "vitest";
import { defineTool } from "./types.js";

describe("defineTool", () => {
  it("marks destructive tools as requiresApproval", () => {
    const tool = defineTool({
      name: "rm",
      description: "remove",
      riskLevel: "destructive",
      parameters: { type: "object", properties: {}, required: [] },
      async execute() { return {}; },
    });

    expect(tool.requiresApproval).toBe(true);
    expect(tool.riskLevel).toBe("destructive");
  });

  it("allows explicit override of requiresApproval for destructive tools", () => {
    const tool = defineTool({
      name: "rm-safe",
      description: "safe remove",
      riskLevel: "destructive",
      requiresApproval: false,
      parameters: { type: "object", properties: {}, required: [] },
      async execute() { return {}; },
    });

    expect(tool.requiresApproval).toBe(false);
  });

  it("does not set requiresApproval for safe tools", () => {
    const tool = defineTool({
      name: "echo",
      description: "echo",
      riskLevel: "safe",
      parameters: { type: "object", properties: {}, required: [] },
      async execute() { return {}; },
    });

    expect(tool.requiresApproval).toBeUndefined();
  });
});
