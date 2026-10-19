import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReminderScheduler, ReminderStore, resolveReminderTime, MAX_REMINDER_HORIZON_MS } from "./reminders.js";

let dir: string;
let file: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rem-"));
  file = join(dir, "reminders.json");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const NOW = Date.parse("2026-10-08T12:00:00Z");

describe("resolveReminderTime", () => {
  it("handles inMinutes and ISO with offset", () => {
    expect(resolveReminderTime({ inMinutes: 10 }, NOW)).toBe(NOW + 600_000);
    expect(resolveReminderTime({ at: "2026-10-09T08:00:00-03:00" }, NOW)).toBe(Date.parse("2026-10-09T11:00:00Z"));
    expect(resolveReminderTime({ at: "2026-10-09T11:00:00Z" }, NOW)).toBe(Date.parse("2026-10-09T11:00:00Z"));
  });

  it("refuses a time with no UTC offset, bad values and missing input", () => {
    expect(() => resolveReminderTime({ at: "2026-10-09T08:00:00" }, NOW)).toThrow(/UTC offset/);
    expect(() => resolveReminderTime({ at: "mañana" }, NOW)).toThrow();
    expect(() => resolveReminderTime({ inMinutes: -5 }, NOW)).toThrow(/positive/);
    expect(() => resolveReminderTime({}, NOW)).toThrow(/inMinutes or at/);
  });
});

describe("ReminderStore", () => {
  it("adds, lists in due order, cancels and survives a reload", async () => {
    const store = new ReminderStore(file);
    await store.load();
    const later = await store.add({ text: "B", dueAt: NOW + 2000, sessionKey: "s" }, NOW);
    const sooner = await store.add({ text: "A", dueAt: NOW + 1000, sessionKey: "s" }, NOW);
    expect(store.pending().map((r) => r.text)).toEqual(["A", "B"]);

    expect(await store.cancel(later.id)).toBe(true);
    expect(await store.cancel(later.id)).toBe(false);

    const reloaded = new ReminderStore(file);
    await reloaded.load();
    expect(reloaded.pending().map((r) => r.id)).toEqual([sooner.id]);
  });

  it("rejects past times, empty text and far-future times", async () => {
    const store = new ReminderStore(file);
    await store.load();
    await expect(store.add({ text: "x", dueAt: NOW - 1, sessionKey: "s" }, NOW)).rejects.toThrow(/past/);
    await expect(store.add({ text: "  ", dueAt: NOW + 1000, sessionKey: "s" }, NOW)).rejects.toThrow(/text required/);
    await expect(store.add({ text: "x", dueAt: NOW + MAX_REMINDER_HORIZON_MS + 1, sessionKey: "s" }, NOW)).rejects.toThrow(/one year/);
  });
});

describe("ReminderScheduler", () => {
  it("fires each due reminder exactly once, even if the handler throws", async () => {
    const store = new ReminderStore(file);
    await store.load();
    await store.add({ text: "ok", dueAt: NOW + 1000, sessionKey: "s" }, NOW);
    await store.add({ text: "boom", dueAt: NOW + 1500, sessionKey: "s" }, NOW);
    await store.add({ text: "later", dueAt: NOW + 999_000, sessionKey: "s" }, NOW);

    const fired: string[] = [];
    const scheduler = new ReminderScheduler(
      store,
      async (r) => {
        fired.push(r.text);
        if (r.text === "boom") throw new Error("push failed");
      },
      () => NOW + 5000,
    );

    expect(await scheduler.tick()).toBe(1); // "boom" threw, so it isn't counted
    expect(fired).toEqual(["ok", "boom"]);
    expect(await scheduler.tick()).toBe(0); // nothing re-fires
    expect(store.pending().map((r) => r.text)).toEqual(["later"]);
  });
});
