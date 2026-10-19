import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WorkflowStore } from "./store.js";
import type { Grant, Run, Workflow } from "@yggdrasil/workflows";

const SETTINGS: Workflow["settings"] = {
  concurrency: "skip",
  timeoutMs: 600_000,
  allowRemoteTrigger: false,
  misfire: "skip",
  misfireGraceMs: 900_000,
};

function workflow(id: string): Workflow {
  return {
    id,
    name: `wf-${id}`,
    version: 1,
    enabled: true,
    triggers: [{ id: "t1", type: "manual" }],
    nodes: [{ id: "a", type: "set", name: "A", position: { x: 0, y: 0 }, params: { name: "x", value: 1 } }],
    edges: [],
    settings: SETTINGS,
  };
}

function run(id: string, workflowId: string, startedAt: string): Run {
  return {
    id,
    workflowId,
    graphHash: "hash",
    trigger: { id: "manual", type: "manual" },
    status: "succeeded",
    startedAt,
    endedAt: startedAt,
    nodes: {},
    artifacts: [],
  };
}

describe("WorkflowStore", () => {
  let store: WorkflowStore;

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "ygg-workflows-store-"));
    store = new WorkflowStore(join(dir, "defs"), join(dir, "state"));
  });

  it("returns an empty list before anything is saved", async () => {
    expect(await store.listWorkflows()).toEqual([]);
    expect(await store.getWorkflow("missing")).toBeUndefined();
  });

  it("round-trips a workflow through save/get/list/delete", async () => {
    await store.saveWorkflow(workflow("wf1"));
    expect(await store.getWorkflow("wf1")).toEqual(workflow("wf1"));
    expect(await store.listWorkflows()).toEqual([workflow("wf1")]);

    await store.deleteWorkflow("wf1");
    expect(await store.getWorkflow("wf1")).toBeUndefined();
    expect(await store.listWorkflows()).toEqual([]);
  });

  it("deleting a workflow that was never saved doesn't throw", async () => {
    await expect(store.deleteWorkflow("ghost")).resolves.toBeUndefined();
  });

  it("round-trips a run through save/get, and lists newest-first filtered by workflowId", async () => {
    await store.saveRun(run("r1", "wf1", "2026-01-01T00:00:00.000Z"));
    await store.saveRun(run("r2", "wf1", "2026-01-02T00:00:00.000Z"));
    await store.saveRun(run("r3", "wf2", "2026-01-03T00:00:00.000Z"));

    expect(await store.getRun("r1")).toEqual(run("r1", "wf1", "2026-01-01T00:00:00.000Z"));
    expect(await store.getRun("missing")).toBeUndefined();

    const wf1Runs = await store.listRuns("wf1");
    expect(wf1Runs.map((r) => r.id)).toEqual(["r2", "r1"]);

    const allRuns = await store.listRuns();
    expect(allRuns.map((r) => r.id)).toEqual(["r3", "r2", "r1"]);
  });

  it("respects the `limit` passed to listRuns", async () => {
    for (let i = 0; i < 5; i++) {
      await store.saveRun(run(`r${i}`, "wf1", `2026-01-0${i + 1}T00:00:00.000Z`));
    }
    expect(await store.listRuns(undefined, 2)).toHaveLength(2);
  });

  it("returns undefined for a grant that was never saved", async () => {
    expect(await store.getGrant("wf1")).toBeUndefined();
  });

  it("round-trips a grant through save/get/delete", async () => {
    const grant: Grant = { workflowId: "wf1", graphHash: "h1", riskyNodes: [], grantedAt: "2026-01-01T00:00:00.000Z", grantedBy: "desktop" };
    await store.saveGrant(grant);
    expect(await store.getGrant("wf1")).toEqual(grant);

    await store.deleteGrant("wf1");
    expect(await store.getGrant("wf1")).toBeUndefined();
  });

  it("deleting a workflow also deletes its grant", async () => {
    await store.saveWorkflow(workflow("wf1"));
    await store.saveGrant({ workflowId: "wf1", graphHash: "h1", riskyNodes: [], grantedAt: "2026-01-01T00:00:00.000Z", grantedBy: "desktop" });

    await store.deleteWorkflow("wf1");
    expect(await store.getGrant("wf1")).toBeUndefined();
  });
});
