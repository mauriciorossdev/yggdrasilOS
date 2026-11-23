import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readAgentTeams, recordAutoCapturedNode } from "./agentTeams.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "agent-teams-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const ceo = { id: "ceo-node", name: "CEO" };

describe("recordAutoCapturedNode", () => {
  it("reuses a same-role child when the orchestrator re-spawns its team", async () => {
    const first = await recordAutoCapturedNode(root, { id: "pane-1", name: "Frontend Engineer", initialPrompt: "v1" }, ceo);
    const second = await recordAutoCapturedNode(root, { id: "pane-2", name: "frontend engineer", initialPrompt: "v2" }, ceo);

    expect(first).toBe("pane-1");
    expect(second).toBe("pane-1");
    const [team] = await readAgentTeams(root);
    expect(team.nodes.map((n) => n.id)).toEqual(["pane-1", "ceo-node"]);
    expect(team.edges).toEqual([{ from: "ceo-node", to: "pane-1" }]);
    const fe = team.nodes.find((n) => n.id === "pane-1")!;
    expect(fe.harness.type === "claude" && fe.harness.initialPrompt).toBe("v2");
  });

  it("treats role names that differ only in spacing as the same role", async () => {
    await recordAutoCapturedNode(root, { id: "pane-1", name: "UX/UI Designer", initialPrompt: "a" }, ceo);
    const id = await recordAutoCapturedNode(root, { id: "pane-2", name: "UX / UI Designer", initialPrompt: "b" }, ceo);

    expect(id).toBe("pane-1");
    expect((await readAgentTeams(root))[0].nodes).toHaveLength(2);
  });

  it("still adds distinct roles, and the same role under a different orchestrator", async () => {
    await recordAutoCapturedNode(root, { id: "pane-1", name: "Frontend Engineer", initialPrompt: "a" }, ceo);
    await recordAutoCapturedNode(root, { id: "pane-2", name: "Backend Engineer", initialPrompt: "b" }, ceo);
    // pane-1 itself spawns a helper with a role name its parent also used.
    await recordAutoCapturedNode(root, { id: "pane-3", name: "Backend Engineer", initialPrompt: "c" }, { id: "pane-1", name: "Frontend Engineer" });

    const [team] = await readAgentTeams(root);
    expect(team.nodes.map((n) => n.id).sort()).toEqual(["ceo-node", "pane-1", "pane-2", "pane-3"]);
    expect(team.edges).toContainEqual({ from: "pane-1", to: "pane-3" });
  });

  it("keeps a reused node's canvas position", async () => {
    await recordAutoCapturedNode(root, { id: "pane-1", name: "QA", initialPrompt: "a" }, ceo);
    const before = (await readAgentTeams(root))[0].nodes.find((n) => n.id === "pane-1")!.position;
    await recordAutoCapturedNode(root, { id: "pane-9", name: "QA", initialPrompt: "b" }, ceo);
    const after = (await readAgentTeams(root))[0].nodes.find((n) => n.id === "pane-1")!.position;
    expect(after).toEqual(before);
  });
});
