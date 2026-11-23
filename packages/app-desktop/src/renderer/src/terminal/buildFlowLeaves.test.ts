import { describe, expect, it } from "vitest";
import type { AgentFlowNode } from "../types.js";
import { buildFlowLeaves, selectTeamRootNodes } from "./buildFlowLeaves.js";

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

describe("buildFlowLeaves — claude user MCP", () => {
  const claudeNode = (harness: object = {}): AgentFlowNode =>
    ({ id: "c1", name: "Worker", position: { x: 0, y: 0 }, harness: { type: "claude", ...harness } }) as AgentFlowNode;

  it("carries the node's own MCP choice to the pane", () => {
    const choice = { mode: "pick" as const, allowed: ["playwright"], known: ["playwright", "aws-mcp"] };
    expect(buildFlowLeaves([claudeNode({ userMcp: choice })], "/p").leaves[0]!.claudeUserMcp).toEqual(choice);
  });

  it("leaves it unset (global setting) when the node has none", () => {
    expect(buildFlowLeaves([claudeNode()], "/p").leaves[0]!.claudeUserMcp).toBeUndefined();
  });
});

describe("buildFlowLeaves — team roster note", () => {
  const node = (id: string, name: string, initialPrompt?: string): AgentFlowNode =>
    ({ id, name, position: { x: 0, y: 0 }, harness: { type: "claude", initialPrompt } }) as AgentFlowNode;
  const lead = node("lead", "Orquestador", "Reparte el trabajo.");
  const front = node("front", "Frontend", "Implementa la UI.");
  const qa = node("qa", "QA", "Escribe tests.");
  const team = [lead, front, qa];
  const edges = [
    { from: "lead", to: "front" },
    { from: "lead", to: "qa" },
  ];
  const leadPrompt = (spawn: AgentFlowNode[]) =>
    buildFlowLeaves(spawn, "/p", edges, team).leaves.find((l) => l.title === "Orquestador")!.initialPrompt!;

  it("lists members as live when they spawn in the same batch (Load into Terminal)", () => {
    const prompt = leadPrompt(team);
    expect(prompt).toContain("spawned alongside you");
    expect(prompt).toContain("- Frontend: Implementa la UI.");
    expect(prompt).not.toContain("not started yet");
  });

  it("asks the root to create members that a saved-team load doesn't spawn", () => {
    const prompt = leadPrompt(selectTeamRootNodes(team, edges));
    expect(prompt).toMatch(/^Reparte el trabajo\./);
    expect(prompt).toContain("not started yet");
    expect(prompt).toContain("create_pane");
    expect(prompt).toContain("- QA: Escribe tests.");
    expect(prompt).not.toContain("spawned alongside you");
  });

  it("splits a partly spawned team into live and to-create", () => {
    const prompt = leadPrompt([lead, front]);
    const [live, missing] = prompt.split("not started yet");
    expect(live).toContain("- Frontend:");
    expect(live).not.toContain("- QA:");
    expect(missing).toContain("- QA:");
  });

  it("leaves a node without members untouched", () => {
    expect(buildFlowLeaves([front], "/p", edges, team).leaves[0]!.initialPrompt).toBe("Implementa la UI.");
  });
});
