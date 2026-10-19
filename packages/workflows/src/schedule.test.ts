import { describe, it, expect } from "vitest";
import { computeNextFire, decideScheduleTick } from "./schedule.js";

const EVERY_MINUTE = "0 * * * * *"; // seconds field included (cron-parser default)
const DAILY_AT_9 = "0 0 9 * * *";

describe("computeNextFire", () => {
  it("returns the next occurrence strictly after the given date", () => {
    const after = new Date("2026-01-01T00:00:30.000Z");
    const next = computeNextFire(EVERY_MINUTE, undefined, after);
    expect(next.toISOString()).toBe("2026-01-01T00:01:00.000Z");
  });

  it("respects an explicit timezone", () => {
    // 9am in America/Argentina/Buenos_Aires (UTC-3) is 12:00 UTC.
    const after = new Date("2026-01-01T00:00:00.000Z");
    const next = computeNextFire(DAILY_AT_9, "America/Argentina/Buenos_Aires", after);
    expect(next.toISOString()).toBe("2026-01-01T12:00:00.000Z");
  });
});

describe("decideScheduleTick", () => {
  it("does nothing before the next occurrence is due", () => {
    const decision = decideScheduleTick({
      cron: EVERY_MINUTE,
      baselineAt: new Date("2026-01-01T00:00:00.000Z"),
      lastCheckedAt: new Date("2026-01-01T00:00:10.000Z"),
      now: new Date("2026-01-01T00:00:20.000Z"),
      misfire: "skip",
      misfireGraceMs: 60_000,
    });
    expect(decision).toEqual({ action: "none" });
  });

  it("fires normally when the gap since the last tick is small (continuous operation)", () => {
    const decision = decideScheduleTick({
      cron: EVERY_MINUTE,
      baselineAt: new Date("2026-01-01T00:00:00.000Z"),
      lastCheckedAt: new Date("2026-01-01T00:00:31.000Z"),
      now: new Date("2026-01-01T00:01:01.000Z"),
      misfire: "skip",
      misfireGraceMs: 0,
    });
    expect(decision.action).toBe("fire");
    if (decision.action !== "none") expect(decision.firedAt.toISOString()).toBe("2026-01-01T00:01:00.000Z");
  });

  it("fires on the very first tick ever if the schedule is already due relative to its baseline", () => {
    // No lastCheckedAt at all (process just started) — still fires because
    // the gap defaults to Infinity, which on its own would look like a
    // misfire, but the misfire policy below still allows it through.
    const decision = decideScheduleTick({
      cron: EVERY_MINUTE,
      baselineAt: new Date("2026-01-01T00:00:00.000Z"),
      now: new Date("2026-01-01T00:01:05.000Z"),
      misfire: "runOnce",
      misfireGraceMs: 120_000,
    });
    expect(decision.action).toBe("fire");
  });

  it("misfire=skip discards a fire missed during a long gap (e.g. the Mac was asleep)", () => {
    // Daily-at-9 job, baseline is yesterday's fire; the process comes back
    // up at 3pm having been down since before 9am (60s gap threshold blown).
    // tz pinned to UTC so this doesn't depend on the machine's local zone.
    const decision = decideScheduleTick({
      cron: DAILY_AT_9,
      timezone: "UTC",
      baselineAt: new Date("2026-01-01T09:00:00.000Z"),
      lastCheckedAt: new Date("2026-01-01T09:00:30.000Z"),
      now: new Date("2026-01-02T15:00:00.000Z"),
      misfire: "skip",
      misfireGraceMs: 3_600_000,
    });
    expect(decision.action).toBe("skip-misfire");
    if (decision.action !== "none") expect(decision.firedAt.toISOString()).toBe("2026-01-02T09:00:00.000Z");
  });

  it("misfire=runOnce replays only the single most recent missed occurrence when within grace", () => {
    const decision = decideScheduleTick({
      cron: EVERY_MINUTE, // would have missed dozens of occurrences over the gap
      baselineAt: new Date("2026-01-01T00:00:00.000Z"),
      lastCheckedAt: new Date("2026-01-01T00:00:30.000Z"),
      now: new Date("2026-01-01T00:10:00.000Z"), // 9.5 minutes of "sleep"
      misfire: "runOnce",
      misfireGraceMs: 120_000, // 2 min grace
    });
    expect(decision.action).toBe("fire");
    if (decision.action !== "none") {
      // The most recent occurrence at/before "now", not the first missed one.
      expect(decision.firedAt.toISOString()).toBe("2026-01-01T00:10:00.000Z");
    }
  });

  it("misfire=runOnce still discards the fire once it's past the grace window", () => {
    const decision = decideScheduleTick({
      cron: DAILY_AT_9,
      baselineAt: new Date("2026-01-01T09:00:00.000Z"),
      lastCheckedAt: new Date("2026-01-01T09:00:30.000Z"),
      now: new Date("2026-01-02T09:00:00.000Z"), // exactly a day late
      misfire: "runOnce",
      misfireGraceMs: 60_000, // 1 min grace — the miss is a full day old
    });
    expect(decision.action).toBe("skip-misfire");
  });

  it("advancing baselineAt to the decided firedAt prevents re-processing the same occurrence next tick", () => {
    const first = decideScheduleTick({
      cron: EVERY_MINUTE,
      baselineAt: new Date("2026-01-01T00:00:00.000Z"),
      lastCheckedAt: new Date("2026-01-01T00:00:30.000Z"),
      now: new Date("2026-01-01T00:01:05.000Z"),
      misfire: "skip",
      misfireGraceMs: 0,
    });
    expect(first.action).toBe("fire");
    if (first.action === "none") throw new Error("unreachable");

    const second = decideScheduleTick({
      cron: EVERY_MINUTE,
      baselineAt: first.firedAt,
      lastCheckedAt: new Date("2026-01-01T00:01:05.000Z"),
      now: new Date("2026-01-01T00:01:20.000Z"),
      misfire: "skip",
      misfireGraceMs: 0,
    });
    expect(second).toEqual({ action: "none" });
  });
});
