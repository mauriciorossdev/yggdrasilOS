import { describe, expect, it } from "vitest";
import type { AgentFlowNode } from "../types.js";
import { buildFlowLeaves } from "./buildFlowLeaves.js";

const yggNode = (harness: object = {}): AgentFlowNode =>
  ({ id: "node-1", name: "Local", position: { x: 0, y: 0 }, harness: { type: "yggdrasil", agentId: "default", ...harness } }) as AgentFlowNode;

describe("buildFlowLeaves — yggdrasil session key", () => {
  it("mints a fresh session key per load by default", () => {
    const a = buildFlowLeaves([yggNode()], "/p").leaves[0]!;
    const b = buildFlowLeaves([yggNode()], "/p").leaves[0]!;
    expect(a.sessionKey).toMatch(/^tui:default:desktop-/);
    expect(a.sessionKey).not.toBe(b.sessionKey);
  });

  it("reuses a stable per-node key when the node continues its conversation", () => {
    const a = buildFlowLeaves([yggNode({ continueSession: true })], "/p").leaves[0]!;
    const b = buildFlowLeaves([yggNode({ continueSession: true })], "/p").leaves[0]!;
    expect(a.sessionKey).toBe("tui:default:desktop-node-node-1");
    expect(b.sessionKey).toBe(a.sessionKey);
  });
});
