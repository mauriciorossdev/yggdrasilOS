import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Workflow } from "@yggdrasil/workflows";
import { WorkflowStore } from "./store.js";
import { executeWorkflowRun } from "./run.js";

function fakeEvents() {
  return { emit: vi.fn(() => Promise.resolve()), on: vi.fn(), off: vi.fn() };
}

const SETTINGS: Workflow["settings"] = {
  concurrency: "skip",
  timeoutMs: 600_000,
  allowRemoteTrigger: false,
  misfire: "skip",
  misfireGraceMs: 900_000,
};

function slowWorkflow(id: string, ms: number): Workflow {
  return {
    id,
    name: "slow",
    version: 1,
    enabled: true,
    triggers: [{ id: "t1", type: "manual" }],
    nodes: [{ id: "a", type: "delay", name: "a", position: { x: 0, y: 0 }, params: { ms } }],
    edges: [],
    settings: SETTINGS,
  };
}

describe("executeWorkflowRun", () => {
  let store: WorkflowStore;

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "ygg-workflows-run-"));
    store = new WorkflowStore(join(dir, "defs"), join(dir, "state"));
  });

  afterEach(() => {
    delete process.env.YGGDRASIL_DESKTOP_SETTINGS_PATH;
  });

  it("the kill switch blocks even a manual run, and nothing gets saved", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ygg-killswitch-run-"));
    const path = join(dir, "desktop-settings.json");
    await writeFile(path, JSON.stringify({ automation: { paused: true } }));
    process.env.YGGDRASIL_DESKTOP_SETTINGS_PATH = path;

    const wf = slowWorkflow("wf-paused", 0);
    const result = await executeWorkflowRun({ workflow: wf, trigger: { id: "t1", type: "manual" }, store, events: fakeEvents() as never });
    expect(result).toEqual({ ok: false, reason: "automation_paused" });
    expect(await store.listRuns("wf-paused")).toEqual([]);
  });

  it("rejects an invalid workflow without running or saving anything", async () => {
    const wf = slowWorkflow("wf1", 0);
    wf.nodes[0]!.type = "not-a-real-type";
    const result = await executeWorkflowRun({ workflow: wf, trigger: { id: "t1", type: "manual" }, store, events: fakeEvents() as never });
    expect(result).toMatchObject({ ok: false, reason: "invalid_workflow" });
    expect(await store.listRuns("wf1")).toEqual([]);
  });

  it("with concurrency:skip, a second trigger while a run is still in flight is dropped", async () => {
    const wf = slowWorkflow("wf-slow", 100);
    const events = fakeEvents();

    const first = executeWorkflowRun({ workflow: wf, trigger: { id: "t1", type: "manual" }, store, events: events as never });
    // Let the first run actually start (its node begins the 100ms delay) before firing the second.
    await new Promise((r) => setTimeout(r, 10));

    const second = await executeWorkflowRun({ workflow: wf, trigger: { id: "t1", type: "manual" }, store, events: events as never });
    expect(second).toEqual({ ok: false, reason: "concurrency_skip" });

    const firstResult = await first;
    expect(firstResult.ok).toBe(true);
  });

  it("a workflow can run again once the previous run has finished", async () => {
    const wf = slowWorkflow("wf-again", 10);
    const events = fakeEvents();

    const first = await executeWorkflowRun({ workflow: wf, trigger: { id: "t1", type: "manual" }, store, events: events as never });
    expect(first.ok).toBe(true);

    const second = await executeWorkflowRun({ workflow: wf, trigger: { id: "t1", type: "manual" }, store, events: events as never });
    expect(second.ok).toBe(true);
  });

  it("concurrency:parallel allows overlapping runs of the same workflow", async () => {
    const wf = slowWorkflow("wf-parallel", 50);
    wf.settings = { ...SETTINGS, concurrency: "parallel" };
    const events = fakeEvents();

    const first = executeWorkflowRun({ workflow: wf, trigger: { id: "t1", type: "manual" }, store, events: events as never });
    await new Promise((r) => setTimeout(r, 5));
    const second = executeWorkflowRun({ workflow: wf, trigger: { id: "t1", type: "manual" }, store, events: events as never });

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.ok).toBe(true);
    expect(secondResult.ok).toBe(true);
  });
});
