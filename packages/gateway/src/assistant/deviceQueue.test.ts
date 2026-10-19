import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DeviceDirectory,
  DeviceQueue,
  MAX_QUEUED_PER_DEVICE,
  QUEUE_TTL_MS,
  drainDeviceQueue,
  type DrainOutcome,
  type QueuedCall,
} from "./deviceQueue.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "queue-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const base = { deviceId: "d1", sessionKey: "assistant:main", kind: "sync" as const };

describe("DeviceDirectory", () => {
  it("remembers a device's tools and its sessions across reloads", async () => {
    const file = join(dir, "devices.json");
    const dirA = new DeviceDirectory(file);
    await dirA.load();
    await dirA.saveTools("d1", [{ name: "phone_set_alarm", description: "x", parameters: { type: "object" }, kind: "sync" }]);
    await dirA.linkSession("assistant:main", "d1");

    const dirB = new DeviceDirectory(file);
    await dirB.load();
    expect(dirB.deviceForSession("assistant:main")).toBe("d1");
    expect(dirB.toolsFor("d1").map((t) => t.name)).toEqual(["phone_set_alarm"]);
    expect(dirB.toolsFor("nope")).toEqual([]);
  });
});

describe("DeviceQueue", () => {
  it("only queues the 'do it later' tools and caps the backlog", async () => {
    const queue = new DeviceQueue(join(dir, "q.json"));
    await queue.load();
    await expect(
      queue.enqueue({ ...base, toolName: "phone_read_calendar", args: {}, riskLevel: "moderate" }),
    ).rejects.toThrow(/cannot be queued/);
    for (let i = 0; i < MAX_QUEUED_PER_DEVICE; i++) {
      await queue.enqueue({ ...base, toolName: "phone_set_alarm", args: { i }, riskLevel: "moderate" });
    }
    await expect(queue.enqueue({ ...base, toolName: "phone_set_alarm", args: {}, riskLevel: "moderate" })).rejects.toThrow(/too many/);

    const reloaded = new DeviceQueue(join(dir, "q.json"));
    await reloaded.load();
    expect(reloaded.list("d1")).toHaveLength(MAX_QUEUED_PER_DEVICE);
  });
});

describe("drainDeviceQueue", () => {
  async function setup(riskLevels: Array<"safe" | "moderate">) {
    const queue = new DeviceQueue(join(dir, "q.json"));
    await queue.load();
    for (const [i, risk] of riskLevels.entries()) {
      await queue.enqueue({ ...base, toolName: "phone_set_alarm", args: { i }, riskLevel: risk }, 1000 + i);
    }
    return queue;
  }

  it("runs safe calls directly and asks approval for the others", async () => {
    const queue = await setup(["safe", "moderate"]);
    const invoked: number[] = [];
    const approvals: number[] = [];
    const reports: Array<[number, DrainOutcome["status"]]> = [];

    const n = await drainDeviceQueue({
      queue,
      deviceId: "d1",
      now: () => 2000,
      invoke: async (c: QueuedCall) => void invoked.push(c.args.i as number),
      approve: async (c) => (approvals.push(c.args.i as number), true),
      report: async (c, o) => void reports.push([c.args.i as number, o.status]),
    });

    expect(n).toBe(2);
    expect(invoked).toEqual([0, 1]);
    expect(approvals).toEqual([1]); // the safe one never asked
    expect(reports).toEqual([[0, "done"], [1, "done"]]);
    expect(queue.list()).toEqual([]);
  });

  it("drops a call the user denies without running it", async () => {
    const queue = await setup(["moderate"]);
    const invoked: number[] = [];
    const reports: string[] = [];
    await drainDeviceQueue({
      queue, deviceId: "d1", now: () => 2000,
      invoke: async () => void invoked.push(1),
      approve: async () => false,
      report: async (_c, o) => void reports.push(o.status),
    });
    expect(invoked).toEqual([]);
    expect(reports).toEqual(["denied"]);
    expect(queue.list()).toEqual([]);
  });

  it("expires calls older than the TTL", async () => {
    const queue = await setup(["safe"]);
    const reports: string[] = [];
    await drainDeviceQueue({
      queue, deviceId: "d1", now: () => 1000 + QUEUE_TTL_MS + 1,
      invoke: async () => { throw new Error("must not run"); },
      approve: async () => true,
      report: async (_c, o) => void reports.push(o.status),
    });
    expect(reports).toEqual(["expired"]);
  });

  it("reports a failing call but keeps going; keeps the rest queued if the phone drops", async () => {
    const queue = await setup(["safe", "safe", "safe"]);
    const reports: string[] = [];
    await drainDeviceQueue({
      queue, deviceId: "d1", now: () => 2000,
      invoke: async (c) => {
        if (c.args.i === 0) throw new Error("native failed");
        if (c.args.i === 1) throw new Error("device connection closed");
      },
      approve: async () => true,
      report: async (_c, o) => void reports.push(o.status),
    });
    expect(reports).toEqual(["failed"]);
    expect(queue.list().map((c) => c.args.i)).toEqual([1, 2]); // 1 and 2 wait for the next connection
  });

  it("never drains the same device twice at once", async () => {
    const queue = await setup(["safe"]);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let runs = 0;
    const deps = {
      queue, deviceId: "d1", now: () => 2000,
      invoke: async () => { runs++; await gate; },
      approve: async () => true,
      report: async () => {},
    };
    const first = drainDeviceQueue(deps);
    const second = await drainDeviceQueue(deps); // started while the first is in flight
    release();
    await first;
    expect(second).toBe(0);
    expect(runs).toBe(1);
  });
});
