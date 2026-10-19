import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Workflow } from "@yggdrasil/workflows";
import { WorkflowStore } from "./store.js";
import { Scheduler } from "./scheduler.js";

function fakeEvents() {
  return { emit: vi.fn((_event: string, _payload?: unknown) => Promise.resolve()), on: vi.fn(), off: vi.fn() };
}
function fakeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function scheduledWorkflow(id: string, overrides: Partial<Workflow> = {}): Workflow {
  return {
    id,
    name: id,
    version: 1,
    enabled: true,
    triggers: [{ id: "sched", type: "schedule", cron: "0 0 9 * * *", timezone: "UTC" }],
    nodes: [{ id: "a", type: "set", name: "a", position: { x: 0, y: 0 }, params: { name: "x", value: 1 } }],
    edges: [],
    settings: { concurrency: "skip", timeoutMs: 600_000, allowRemoteTrigger: false, misfire: "skip", misfireGraceMs: 3_600_000 },
    ...overrides,
  };
}

describe("Scheduler", () => {
  let store: WorkflowStore;

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "ygg-scheduler-"));
    store = new WorkflowStore(join(dir, "defs"), join(dir, "state"));
  });

  it("does not fire before the workflow's schedule is due", async () => {
    await store.saveWorkflow(scheduledWorkflow("wf1"));
    const events = fakeEvents();
    const scheduler = new Scheduler(store, events as never, fakeLogger());

    await scheduler.tick(new Date("2026-01-01T08:00:00.000Z"));

    expect(await store.listRuns("wf1")).toEqual([]);
    expect(events.emit).not.toHaveBeenCalled();
  });

  it("fires once the schedule is due, on a normal continuously-ticking gateway", async () => {
    await store.saveWorkflow(scheduledWorkflow("wf1"));
    const events = fakeEvents();
    const scheduler = new Scheduler(store, events as never, fakeLogger());

    // First tick establishes lastCheckedAt without being due yet.
    await scheduler.tick(new Date("2026-01-01T08:59:30.000Z"));
    // Second tick, 30s later, crosses 09:00:00 — a normal small gap, so it fires.
    await scheduler.tick(new Date("2026-01-01T09:00:00.000Z"));

    const runs = await store.listRuns("wf1");
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("succeeded");
    expect(runs[0]!.trigger).toEqual({ id: "sched", type: "schedule" });

    const emittedEvents = events.emit.mock.calls.map(([event]) => event);
    expect(emittedEvents).toContain("workflow.run.started");
    expect(emittedEvents).toContain("workflow.run.finished");
  });

  it("does not fire the same occurrence twice on a later tick", async () => {
    await store.saveWorkflow(scheduledWorkflow("wf1"));
    const events = fakeEvents();
    const scheduler = new Scheduler(store, events as never, fakeLogger());

    await scheduler.tick(new Date("2026-01-01T08:59:30.000Z"));
    await scheduler.tick(new Date("2026-01-01T09:00:00.000Z"));
    await scheduler.tick(new Date("2026-01-01T09:00:30.000Z"));

    expect(await store.listRuns("wf1")).toHaveLength(1);
  });

  it("skips a disabled workflow even when its schedule is due", async () => {
    await store.saveWorkflow(scheduledWorkflow("wf1", { enabled: false }));
    const events = fakeEvents();
    const scheduler = new Scheduler(store, events as never, fakeLogger());

    await scheduler.tick(new Date("2026-01-01T08:59:30.000Z"));
    await scheduler.tick(new Date("2026-01-01T09:00:00.000Z"));

    expect(await store.listRuns("wf1")).toEqual([]);
  });

  it("misfire:skip discards a fire missed while the process was down, without running it", async () => {
    await store.saveWorkflow(scheduledWorkflow("wf1", { settings: { concurrency: "skip", timeoutMs: 600_000, allowRemoteTrigger: false, misfire: "skip", misfireGraceMs: 3_600_000 } }));
    const events = fakeEvents();
    const scheduler = new Scheduler(store, events as never, fakeLogger());

    // One tick well before 09:00, then the "process" comes back many hours
    // later — simulating a long sleep/restart gap, not a normal 30s tick.
    await scheduler.tick(new Date("2026-01-01T02:00:00.000Z"));
    await scheduler.tick(new Date("2026-01-01T15:00:00.000Z"));

    expect(await store.listRuns("wf1")).toEqual([]);
  });

  it("misfire:runOnce replays the missed fire when the gateway comes back within grace", async () => {
    await store.saveWorkflow(
      scheduledWorkflow("wf1", { settings: { concurrency: "skip", timeoutMs: 600_000, allowRemoteTrigger: false, misfire: "runOnce", misfireGraceMs: 3_600_000 * 12 } }),
    );
    const events = fakeEvents();
    const scheduler = new Scheduler(store, events as never, fakeLogger());

    await scheduler.tick(new Date("2026-01-01T02:00:00.000Z"));
    await scheduler.tick(new Date("2026-01-01T15:00:00.000Z")); // 6h after the 9am miss, within 12h grace

    expect(await store.listRuns("wf1")).toHaveLength(1);
  });

  it("tracks two workflows' schedules independently", async () => {
    await store.saveWorkflow(scheduledWorkflow("wf-a", { triggers: [{ id: "sched", type: "schedule", cron: "0 0 9 * * *", timezone: "UTC" }] }));
    await store.saveWorkflow(scheduledWorkflow("wf-b", { triggers: [{ id: "sched", type: "schedule", cron: "0 30 9 * * *", timezone: "UTC" }] }));
    const events = fakeEvents();
    const scheduler = new Scheduler(store, events as never, fakeLogger());

    await scheduler.tick(new Date("2026-01-01T08:59:30.000Z"));
    await scheduler.tick(new Date("2026-01-01T09:00:00.000Z"));
    expect(await store.listRuns("wf-a")).toHaveLength(1);
    expect(await store.listRuns("wf-b")).toHaveLength(0);

    await scheduler.tick(new Date("2026-01-01T09:29:30.000Z"));
    await scheduler.tick(new Date("2026-01-01T09:30:00.000Z"));
    expect(await store.listRuns("wf-b")).toHaveLength(1);
  });
});
