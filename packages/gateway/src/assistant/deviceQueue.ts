import { randomUUID } from "node:crypto";
import { readJsonFile, writeJsonFile } from "./jsonFile.js";

export type StoredDeviceTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  kind: "sync" | "interactive";
};

type DirectoryData = {
  devices: Record<string, { tools: StoredDeviceTool[]; lastSeen: number }>;
  sessions: Record<string, string>;
};

/**
 * What the gateway remembers of each phone between connections: its last
 * declared tools and which device a chat session belongs to. This is what
 * lets the assistant still *see* (and queue) phone actions while the app is closed.
 */
export class DeviceDirectory {
  private data: DirectoryData = { devices: {}, sessions: {} };

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    this.data = await readJsonFile<DirectoryData>(this.file, { devices: {}, sessions: {} });
  }

  async saveTools(deviceId: string, tools: StoredDeviceTool[]): Promise<void> {
    this.data.devices[deviceId] = { tools, lastSeen: Date.now() };
    await writeJsonFile(this.file, this.data);
  }

  async linkSession(sessionKey: string, deviceId: string): Promise<void> {
    if (this.data.sessions[sessionKey] === deviceId) return;
    this.data.sessions[sessionKey] = deviceId;
    await writeJsonFile(this.file, this.data);
  }

  deviceForSession(sessionKey: string): string | undefined {
    return this.data.sessions[sessionKey];
  }

  toolsFor(deviceId: string): StoredDeviceTool[] {
    return this.data.devices[deviceId]?.tools ?? [];
  }
}

/**
 * Actions that make sense to run later, when the phone is back: they return no
 * data the model needs *now*. Reads (calendar, contacts, location) and anything
 * conversational are deliberately not queueable.
 */
export const QUEUEABLE_TOOLS = new Set([
  "phone_set_alarm",
  "phone_set_timer",
  "phone_add_calendar_event",
  "phone_show_notification",
  "phone_set_ringer_mode",
  "phone_set_volume",
]);

export const QUEUE_TTL_MS = 24 * 3600_000;
export const MAX_QUEUED_PER_DEVICE = 20;

export type QueuedCall = {
  id: string;
  deviceId: string;
  sessionKey: string;
  toolName: string;
  args: Record<string, unknown>;
  kind: "sync" | "interactive";
  riskLevel: "safe" | "moderate" | "destructive";
  createdAt: number;
  expiresAt: number;
};

export class DeviceQueue {
  private items: QueuedCall[] = [];

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    this.items = await readJsonFile<QueuedCall[]>(this.file, []);
  }

  private save(): Promise<void> {
    return writeJsonFile(this.file, this.items);
  }

  list(deviceId?: string): QueuedCall[] {
    return this.items.filter((c) => !deviceId || c.deviceId === deviceId);
  }

  async enqueue(input: Omit<QueuedCall, "id" | "createdAt" | "expiresAt">, now = Date.now()): Promise<QueuedCall> {
    if (!QUEUEABLE_TOOLS.has(input.toolName)) throw new Error(`"${input.toolName}" cannot be queued`);
    if (this.list(input.deviceId).length >= MAX_QUEUED_PER_DEVICE) throw new Error("too many queued actions for this phone");
    const call: QueuedCall = { ...input, id: randomUUID().slice(0, 8), createdAt: now, expiresAt: now + QUEUE_TTL_MS };
    this.items.push(call);
    await this.save();
    return call;
  }

  async remove(id: string): Promise<void> {
    this.items = this.items.filter((c) => c.id !== id);
    await this.save();
  }
}

export type DrainOutcome =
  | { status: "done" }
  | { status: "denied" }
  | { status: "expired" }
  | { status: "failed"; detail: string };

export type DrainDeps = {
  queue: DeviceQueue;
  deviceId: string;
  now?: () => number;
  /** Runs the call on the (now connected) phone. */
  invoke: (call: QueuedCall) => Promise<unknown>;
  /** Asks the user to approve a non-safe call. */
  approve: (call: QueuedCall) => Promise<boolean>;
  report: (call: QueuedCall, outcome: DrainOutcome) => Promise<void>;
};

const draining = new Set<string>();

/**
 * Runs everything queued for [deviceId], oldest first. Non-safe calls still go
 * through user approval (the approval that couldn't happen while the phone
 * was away). If the phone drops mid-drain the rest stay queued for next time.
 */
export async function drainDeviceQueue(deps: DrainDeps): Promise<number> {
  if (draining.has(deps.deviceId)) return 0;
  draining.add(deps.deviceId);
  let handled = 0;
  try {
    const now = deps.now ?? Date.now;
    for (const call of [...deps.queue.list(deps.deviceId)].sort((a, b) => a.createdAt - b.createdAt)) {
      if (call.expiresAt <= now()) {
        await deps.queue.remove(call.id);
        await deps.report(call, { status: "expired" });
        handled++;
        continue;
      }
      if (call.riskLevel !== "safe" && !(await deps.approve(call))) {
        await deps.queue.remove(call.id);
        await deps.report(call, { status: "denied" });
        handled++;
        continue;
      }
      try {
        await deps.invoke(call);
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        if (/connection closed|device_offline/i.test(detail)) break; // phone left again: keep the rest queued
        await deps.queue.remove(call.id);
        await deps.report(call, { status: "failed", detail });
        handled++;
        continue;
      }
      await deps.queue.remove(call.id);
      await deps.report(call, { status: "done" });
      handled++;
    }
  } finally {
    draining.delete(deps.deviceId);
  }
  return handled;
}
