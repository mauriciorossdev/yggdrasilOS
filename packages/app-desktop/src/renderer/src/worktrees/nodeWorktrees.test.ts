import { describe, expect, it } from "vitest";
import type { AgentFlowNode } from "../types.js";
import { createNodeWorktrees } from "./nodeWorktrees.js";

const node = (id: string, name: string, worktree?: boolean): AgentFlowNode => ({
  id,
  name,
  position: { x: 0, y: 0 },
  harness: { type: "claude" },
  worktree,
});

describe("createNodeWorktrees", () => {
  it("creates one worktree per node that asks for it, named after the node", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const call = async (_m: string, p?: Record<string, unknown>) => {
      calls.push(p!);
      return { path: `/p/.yggdrasil/worktrees/${p!.name}` } as never;
    };
    const paths = await createNodeWorktrees(call, [node("1", "Front End", true), node("2", "back"), node("3", "Back-end", true)]);
    expect([...paths]).toEqual([
      ["1", "/p/.yggdrasil/worktrees/front-end"],
      ["3", "/p/.yggdrasil/worktrees/back-end"],
    ]);
    expect(calls.map((c) => c.name)).toEqual(["front-end", "back-end"]);
  });

  it("adds -2, -3 when the name is taken", async () => {
    const taken = new Set(["lead", "lead-2"]);
    const call = async (_m: string, p?: Record<string, unknown>) => {
      if (taken.has(String(p!.name))) throw new Error(`INTERNAL_ERROR: git.worktreeAdd: .yggdrasil/worktrees/${p!.name} already exists`);
      return { path: `/w/${p!.name}` } as never;
    };
    expect([...(await createNodeWorktrees(call, [node("1", "Lead", true)]))]).toEqual([["1", "/w/lead-3"]]);
  });

  it("stops on any other error instead of running in the shared folder", async () => {
    const call = async () => {
      throw new Error("INTERNAL_ERROR: git.repos: not a git repository");
    };
    await expect(createNodeWorktrees(call, [node("1", "x", true)])).rejects.toThrow(/Could not create a worktree for "x": not a git repository/);
  });
});
