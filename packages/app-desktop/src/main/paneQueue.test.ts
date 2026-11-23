import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_QUEUE, editQueued, enqueue, moveQueued, removeQueued, setPaused, shouldHold, takeNext } from "./paneQueue.js";

const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock("electron", () => ({ ipcMain: { handle: (name: string, fn: (...args: unknown[]) => unknown) => handlers.set(name, fn) } }));

const app = { kind: "app" } as const;

describe("paneQueue model", () => {
  it("queues in order, edits, moves, removes, and hands over one at a time", () => {
    let q = enqueue(EMPTY_QUEUE, "one", app, 1).queue;
    q = enqueue(q, "two", { kind: "remote" }, 2).queue;
    const third = enqueue(q, "three", app, 3);
    q = third.queue;
    q = editQueued(q, third.item.id, "three!");
    q = moveQueued(q, third.item.id, -1);
    expect(q.items.map((m) => m.text)).toEqual(["one", "three!", "two"]);
    expect(moveQueued(q, q.items[0]!.id, -1)).toBe(q);
    expect(editQueued(q, third.item.id, "   ")).toBe(q);

    const first = takeNext(q);
    expect(first.item?.text).toBe("one");
    q = removeQueued(first.queue, third.item.id).queue;
    expect(q.items.map((m) => m.text)).toEqual(["two"]);
  });

  it("a paused queue hands nothing over", () => {
    const q = setPaused(enqueue(EMPTY_QUEUE, "x", app).queue, true);
    expect(takeNext(q).item).toBeUndefined();
    expect(takeNext(setPaused(q, false)).item?.text).toBe("x");
  });

  it("holds a message only for a busy agent, or behind others, unless it's 'now' or the setting is off", () => {
    const base = { enabled: true, when: "auto" as const, queued: 0 };
    expect(shouldHold({ ...base, status: "working" })).toBe(true);
    expect(shouldHold({ ...base, status: "waiting" })).toBe(true);
    expect(shouldHold({ ...base, status: "done" })).toBe(false);
    expect(shouldHold({ ...base, status: undefined })).toBe(false);
    expect(shouldHold({ ...base, status: undefined, queued: 1 })).toBe(true);
    expect(shouldHold({ ...base, status: "working", when: "now" })).toBe(false);
    expect(shouldHold({ ...base, status: "working", enabled: false })).toBe(false);
  });
});

describe("paneQueueHost", () => {
  let host: typeof import("./paneQueueHost.js");
  let status: "working" | "waiting" | "done" | undefined;
  let delivered: string[];
  let sent: Array<{ channel: string; payload: unknown }>;

  beforeEach(async () => {
    vi.resetModules();
    handlers.clear();
    host = await import("./paneQueueHost.js");
    status = "working";
    delivered = [];
    sent = [];
    const win = { isDestroyed: () => false, webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) } };
    host.installPaneQueue({
      getWindow: () => win as never,
      paneTitle: (_p, id) => (id === "orch" ? "orquestador" : undefined),
      status: () => status,
      enabled: () => true,
      deliver: async (_pane, text) => void delivered.push(text),
    });
  });

  it("queues while the agent works and hands over one message per finished turn", async () => {
    expect(host.gateSubmit("p", "a", "first", { source: { kind: "orchestrator", paneId: "orch" } })).toEqual({ queued: true, position: 1 });
    expect(host.gateSubmit("p", "a", "second", {})).toEqual({ queued: true, position: 2 });
    expect(host.queueSnapshot("p").a?.items[0]).toMatchObject({ text: "first", sourceLabel: "orquestador" });

    expect(host.onTurnEnd("p", "a")).toBe(true);
    await Promise.resolve();
    expect(delivered).toEqual(["first"]);
    expect(host.onTurnEnd("p", "a")).toBe(true);
    expect(host.onTurnEnd("p", "a")).toBe(false);
    await Promise.resolve();
    expect(delivered).toEqual(["first", "second"]);
  });

  it("lets a message through when the agent is free, or when sent 'now'", () => {
    status = "done";
    expect(host.gateSubmit("p", "a", "hi", {})).toBeNull();
    status = "working";
    expect(host.gateSubmit("p", "a", "urgent", { when: "now" })).toBeNull();
  });

  it("an interrupt pauses the queue; resuming while idle delivers the head", async () => {
    host.gateSubmit("p", "a", "later", {});
    host.onInterrupt("p", "a");
    expect(host.onTurnEnd("p", "a")).toBe(false);
    status = undefined;
    await handlers.get("queue:pause")!({}, "p", "a", false);
    await Promise.resolve();
    expect(delivered).toEqual(["later"]);
  });

  it("send now takes one out of order; a closed pane drops its queue and says so", async () => {
    host.gateSubmit("p", "a", "one", {});
    host.gateSubmit("p", "a", "two", {});
    const id = host.queueSnapshot("p").a!.items[1]!.id;
    await handlers.get("queue:sendNow")!({}, "p", "a", id);
    await Promise.resolve();
    expect(delivered).toEqual(["two"]);

    host.dropPane("p", "a");
    expect(host.queueSnapshot("p")).toEqual({});
    expect(sent.find((s) => s.channel === "queue:dropped")?.payload).toEqual({ paneId: "a", title: "a", count: 1 });
  });
});
