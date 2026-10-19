import { randomUUID } from "node:crypto";
import { readJsonFile, writeJsonFile } from "./jsonFile.js";

export type Reminder = {
  id: string;
  text: string;
  dueAt: number;
  createdAt: number;
  sessionKey: string;
  status: "pending" | "fired" | "cancelled";
};

export const MAX_REMINDER_HORIZON_MS = 366 * 24 * 3600_000;
export const MAX_PENDING_REMINDERS = 100;

export class ReminderStore {
  private items: Reminder[] = [];

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    this.items = await readJsonFile<Reminder[]>(this.file, []);
  }

  private save(): Promise<void> {
    // Keep history short: only recent finished reminders besides the pending ones.
    const finished = this.items.filter((r) => r.status !== "pending").slice(-50);
    this.items = [...this.items.filter((r) => r.status === "pending"), ...finished];
    return writeJsonFile(this.file, this.items);
  }

  pending(): Reminder[] {
    return this.items.filter((r) => r.status === "pending").sort((a, b) => a.dueAt - b.dueAt);
  }

  due(now: number): Reminder[] {
    return this.pending().filter((r) => r.dueAt <= now);
  }

  async add(input: { text: string; dueAt: number; sessionKey: string }, now = Date.now()): Promise<Reminder> {
    const text = input.text.trim();
    if (!text) throw new Error("text required");
    if (input.dueAt <= now) throw new Error("the reminder time is in the past");
    if (input.dueAt - now > MAX_REMINDER_HORIZON_MS) throw new Error("reminders can be at most one year ahead");
    if (this.pending().length >= MAX_PENDING_REMINDERS) throw new Error("too many pending reminders");
    const reminder: Reminder = {
      id: randomUUID().slice(0, 8),
      text: text.slice(0, 500),
      dueAt: input.dueAt,
      createdAt: now,
      sessionKey: input.sessionKey,
      status: "pending",
    };
    this.items.push(reminder);
    await this.save();
    return reminder;
  }

  async cancel(id: string): Promise<boolean> {
    const r = this.items.find((x) => x.id === id && x.status === "pending");
    if (!r) return false;
    r.status = "cancelled";
    await this.save();
    return true;
  }

  async markFired(id: string): Promise<void> {
    const r = this.items.find((x) => x.id === id);
    if (!r) return;
    r.status = "fired";
    await this.save();
  }
}

/**
 * Parses what the model gives for "when": either `inMinutes` or an ISO-8601
 * date-time that carries an explicit UTC offset (the server has no idea of the
 * user's time zone, so an offset-less local time would be silently wrong).
 */
export function resolveReminderTime(args: { inMinutes?: unknown; at?: unknown }, now = Date.now()): number {
  if (args.inMinutes !== undefined && args.inMinutes !== null && args.inMinutes !== "") {
    const minutes = Number(args.inMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) throw new Error("inMinutes must be a positive number");
    return now + Math.round(minutes * 60_000);
  }
  const at = String(args.at ?? "").trim();
  if (!at) throw new Error("give either inMinutes or at");
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(at)) {
    throw new Error('"at" must include a UTC offset, e.g. 2026-10-09T08:00:00-03:00 (call phone_current_time first)');
  }
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) throw new Error('"at" is not a valid ISO-8601 date-time');
  return ms;
}

/** Fires due reminders through [onFire]; a failing handler never kills the loop. */
export class ReminderScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly store: ReminderStore,
    private readonly onFire: (reminder: Reminder) => Promise<void>,
    private readonly now: () => number = Date.now,
  ) {}

  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let fired = 0;
    try {
      for (const reminder of this.store.due(this.now())) {
        // Mark first: a crash after firing must not re-fire it on restart.
        await this.store.markFired(reminder.id);
        try {
          await this.onFire(reminder);
          fired++;
        } catch {
          // Best effort — the reminder is already marked so it can't loop forever.
        }
      }
    } finally {
      this.running = false;
    }
    return fired;
  }

  start(intervalMs = 15_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref?.();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
