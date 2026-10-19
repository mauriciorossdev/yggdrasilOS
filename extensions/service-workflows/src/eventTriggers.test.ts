import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Workflow } from "@yggdrasil/workflows";
import { WorkflowStore } from "./store.js";
import { registerEventTriggers } from "./eventTriggers.js";

type Handler = (payload: unknown) => void | Promise<void>;

function fakeEvents() {
  const handlers = new Map<string, Handler[]>();
  return {
    emit: vi.fn((event: string, payload: unknown) => {
      for (const h of handlers.get(event) ?? []) void h(payload);
      return Promise.resolve();
    }),
    on: vi.fn((event: string, handler: Handler) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return () => {
        handlers.set(
          event,
          (handlers.get(event) ?? []).filter((h) => h !== handler),
        );
      };
    }),
    off: vi.fn(),
    // test helper, not part of EventBus
    fire(event: string, payload: unknown) {
      for (const h of handlers.get(event) ?? []) void h(payload);
    },
  };
}

function fakeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const SETTINGS: Workflow["settings"] = {
  concurrency: "skip",
  timeoutMs: 600_000,
  allowRemoteTrigger: false,
  misfire: "skip",
  misfireGraceMs: 900_000,
};

function eventWorkflow(id: string, overrides: Partial<Workflow> = {}): Workflow {
  return {
    id,
    name: id,
    version: 1,
    enabled: true,
    triggers: [{ id: "onchange", type: "event", event: "fs.changed" }],
    nodes: [{ id: "a", type: "set", name: "a", position: { x: 0, y: 0 }, params: { name: "x", value: 1 } }],
    edges: [],
    settings: SETTINGS,
    ...overrides,
  };
}

describe("registerEventTriggers", () => {
  let store: WorkflowStore;

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "ygg-event-triggers-"));
    store = new WorkflowStore(join(dir, "defs"), join(dir, "state"));
  });

  it("runs a workflow whose event trigger matches the fired event", async () => {
    await store.saveWorkflow(eventWorkflow("wf1"));
    const events = fakeEvents();
    registerEventTriggers({ events: events as never, store, logger: fakeLogger() });

    events.fire("fs.changed", { path: "a.txt" });
    await new Promise((r) => setTimeout(r, 20));

    const runs = await store.listRuns("wf1");
    expect(runs).toHaveLength(1);
    expect(runs[0]!.trigger).toEqual({ id: "onchange", type: "event", payload: { path: "a.txt" } });
  });

  it("ignores an event name the trigger doesn't subscribe to", async () => {
    await store.saveWorkflow(eventWorkflow("wf1"));
    const events = fakeEvents();
    registerEventTriggers({ events: events as never, store, logger: fakeLogger() });

    events.fire("turn.completed", {});
    await new Promise((r) => setTimeout(r, 20));

    expect(await store.listRuns("wf1")).toEqual([]);
  });

  it("skips a disabled workflow", async () => {
    await store.saveWorkflow(eventWorkflow("wf1", { enabled: false }));
    const events = fakeEvents();
    registerEventTriggers({ events: events as never, store, logger: fakeLogger() });

    events.fire("fs.changed", {});
    await new Promise((r) => setTimeout(r, 20));

    expect(await store.listRuns("wf1")).toEqual([]);
  });

  it("respects a Condition filter on the event payload", async () => {
    await store.saveWorkflow(
      eventWorkflow("wf1", {
        triggers: [{ id: "onchange", type: "event", event: "fs.changed", filter: { op: "eq", left: "trigger.kind", right: "created" } }],
      }),
    );
    const events = fakeEvents();
    registerEventTriggers({ events: events as never, store, logger: fakeLogger() });

    events.fire("fs.changed", { kind: "deleted" });
    await new Promise((r) => setTimeout(r, 20));
    expect(await store.listRuns("wf1")).toEqual([]);

    events.fire("fs.changed", { kind: "created" });
    await new Promise((r) => setTimeout(r, 20));
    expect(await store.listRuns("wf1")).toHaveLength(1);
  });

  it("guards against a workflow re-triggering on its own workflow.run.finished event", async () => {
    await store.saveWorkflow(
      eventWorkflow("wf1", { triggers: [{ id: "onfinish", type: "event", event: "workflow.run.finished" }] }),
    );
    const events = fakeEvents();
    registerEventTriggers({ events: events as never, store, logger: fakeLogger() });

    events.fire("workflow.run.finished", { workflowId: "wf1", status: "succeeded" });
    await new Promise((r) => setTimeout(r, 20));

    expect(await store.listRuns("wf1")).toEqual([]);
  });

  it("a workflow can react to a DIFFERENT workflow's run.finished event", async () => {
    await store.saveWorkflow(
      eventWorkflow("wf-reactor", { triggers: [{ id: "onfinish", type: "event", event: "workflow.run.finished" }] }),
    );
    const events = fakeEvents();
    registerEventTriggers({ events: events as never, store, logger: fakeLogger() });

    events.fire("workflow.run.finished", { workflowId: "wf-other", status: "succeeded" });
    await new Promise((r) => setTimeout(r, 20));

    expect(await store.listRuns("wf-reactor")).toHaveLength(1);
  });

  it("unsubscribe() stops future runs", async () => {
    await store.saveWorkflow(eventWorkflow("wf1"));
    const events = fakeEvents();
    const unsubscribe = registerEventTriggers({ events: events as never, store, logger: fakeLogger() });

    unsubscribe();
    events.fire("fs.changed", {});
    await new Promise((r) => setTimeout(r, 20));

    expect(await store.listRuns("wf1")).toEqual([]);
  });
});
