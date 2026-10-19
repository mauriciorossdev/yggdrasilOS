// Pure scheduling logic for `schedule` triggers — no I/O, no timers. See
// notes/automation/workflows-design.md §5.11. The engine's tick loop
// (extensions/service-workflows/src/scheduler.ts) calls decideScheduleTick
// once per (workflow, trigger) on every tick and persists whatever it
// returns; everything here is deterministic given its inputs, so it's
// tested with fixed clocks instead of real timers.
import { CronExpressionParser } from "cron-parser";

/** First occurrence strictly after `after`. */
export function computeNextFire(cron: string, timezone: string | undefined, after: Date): Date {
  const expr = CronExpressionParser.parse(cron, { currentDate: after, tz: timezone });
  return expr.next().toDate();
}

/** Latest occurrence at or before `at` (inclusive, via a 1ms-later reference point). */
function latestOccurrenceAtOrBefore(cron: string, timezone: string | undefined, at: Date): Date {
  const expr = CronExpressionParser.parse(cron, { currentDate: new Date(at.getTime() + 1), tz: timezone });
  return expr.prev().toDate();
}

export type ScheduleTickDecision = { action: "none" } | { action: "fire" | "skip-misfire"; firedAt: Date };

export type ScheduleTickInput = {
  cron: string;
  timezone?: string;
  /** lastFiredAt if this trigger has fired before, otherwise when the scheduler first saw it (never backfire before that). */
  baselineAt: Date;
  /** When the scheduler last ticked at all, for ANY trigger — undefined means this is the first tick since process start. */
  lastCheckedAt?: Date;
  now: Date;
  misfire: "skip" | "runOnce";
  misfireGraceMs: number;
  /** Gap above which a tick is treated as "the process was asleep/down", not just normal 30s cadence. Default 2x a normal ~30s tick. */
  liveTickToleranceMs?: number;
};

const DEFAULT_LIVE_TICK_TOLERANCE_MS = 90_000;

/**
 * Decides whether a schedule trigger is due on this tick, and — if the
 * scheduler was away long enough to have missed one or more occurrences —
 * whether the misfire policy says to run it anyway. Only ever replays the
 * single most recent missed occurrence, never one run per missed period.
 */
export function decideScheduleTick(input: ScheduleTickInput): ScheduleTickDecision {
  const liveTickToleranceMs = input.liveTickToleranceMs ?? DEFAULT_LIVE_TICK_TOLERANCE_MS;
  const dueAt = computeNextFire(input.cron, input.timezone, input.baselineAt);
  if (dueAt > input.now) return { action: "none" };

  const latest = latestOccurrenceAtOrBefore(input.cron, input.timezone, input.now);
  const firedAt = latest > dueAt ? latest : dueAt;

  const gapMs = input.lastCheckedAt ? input.now.getTime() - input.lastCheckedAt.getTime() : Infinity;
  if (gapMs <= liveTickToleranceMs) return { action: "fire", firedAt };

  if (input.misfire === "runOnce" && input.now.getTime() - firedAt.getTime() <= input.misfireGraceMs) {
    return { action: "fire", firedAt };
  }
  return { action: "skip-misfire", firedAt };
}
