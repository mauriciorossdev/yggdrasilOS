import { join } from "node:path";
import { registerTool } from "@yggdrasil/kernel";
import { defineTool } from "@yggdrasil/tools-sdk";
import type { SessionStore } from "@yggdrasil/sessions";
import { DeviceDirectory, DeviceQueue } from "./deviceQueue.js";
import { DesktopRegistry } from "./desktops.js";
import { FcmSender, PushService, PushStore } from "./push.js";
import { ReminderScheduler, ReminderStore, resolveReminderTime } from "./reminders.js";

type Events = { emit(event: string, payload: unknown): unknown };

export type AssistantServices = {
  push: PushService;
  reminders: ReminderStore;
  scheduler: ReminderScheduler;
  directory: DeviceDirectory;
  queue: DeviceQueue;
  /** Desktops that published their gateways here (phone discovery). */
  desktops: DesktopRegistry;
  /** Appends an assistant message to a chat session and shows it live in any open chat. */
  postToSession(sessionKey: string, text: string): Promise<void>;
  start(): void;
  stop(): void;
};

export async function createAssistantServices(options: {
  workspaceRoot: string;
  events: Events;
  sessionStore?: SessionStore | null;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<AssistantServices> {
  const env = options.env ?? process.env;
  const dir = join(options.workspaceRoot, ".yggdrasil", "assistant");

  const pushStore = new PushStore(join(dir, "push-devices.json"));
  const reminders = new ReminderStore(join(dir, "reminders.json"));
  const directory = new DeviceDirectory(join(dir, "devices.json"));
  const queue = new DeviceQueue(join(dir, "queue.json"));
  const desktops = new DesktopRegistry(join(dir, "desktops.json"));
  await Promise.all([pushStore.load(), reminders.load(), directory.load(), queue.load(), desktops.load()]);

  const push = new PushService(pushStore, new FcmSender({ serviceAccountJson: env.FCM_SERVICE_ACCOUNT_JSON, fetchImpl: options.fetchImpl }));

  const postToSession = async (sessionKey: string, text: string): Promise<void> => {
    await options.sessionStore?.appendAssistant(sessionKey, text);
    await options.events.emit("chat.final", { sessionKey, text, harnessId: "assistant-service" });
  };

  const scheduler = new ReminderScheduler(reminders, async (reminder) => {
    await postToSession(reminder.sessionKey, `⏰ Recordatorio: ${reminder.text}`);
    await push.notify({
      title: "Recordatorio",
      body: reminder.text,
      data: { type: "reminder", sessionKey: reminder.sessionKey, reminderId: reminder.id },
    });
  });

  return {
    push,
    reminders,
    scheduler,
    directory,
    queue,
    desktops,
    postToSession,
    start: () => scheduler.start(),
    stop: () => scheduler.stop(),
  };
}

/** Server-side tools the assistant can call (they run on the gateway, not on the phone). */
export function registerAssistantTools(services: AssistantServices): void {
  registerTool(
    defineTool({
      name: "reminder_create",
      description:
        "Schedule a reminder: at the chosen moment the user gets a push notification and a message in this chat, even if the app is closed. Give either inMinutes (relative) or at (an ISO-8601 date-time WITH UTC offset, e.g. 2026-10-09T08:00:00-03:00; call phone_current_time first to know the offset and today's date).",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "What to remind the user of, written as the message they will read." },
          inMinutes: { type: "number", description: "Minutes from now." },
          at: { type: "string", description: "ISO-8601 date-time with UTC offset." },
        },
        required: ["text"],
      },
      async execute(ctx, args) {
        const dueAt = resolveReminderTime({ inMinutes: args.inMinutes, at: args.at });
        const reminder = await services.reminders.add({ text: String(args.text ?? ""), dueAt, sessionKey: ctx.sessionKey });
        return {
          id: reminder.id,
          dueAt: new Date(dueAt).toISOString(),
          pushReady: services.push.configured && services.push.deviceCount() > 0,
        };
      },
    }),
  );

  registerTool(
    defineTool({
      name: "reminder_list",
      description: "List the user's pending reminders (id, text, due time).",
      riskLevel: "safe",
      parameters: { type: "object", properties: {} },
      async execute() {
        return {
          reminders: services.reminders.pending().map((r) => ({ id: r.id, text: r.text, dueAt: new Date(r.dueAt).toISOString() })),
        };
      },
    }),
  );

  registerTool(
    defineTool({
      name: "reminder_cancel",
      description: "Cancel a pending reminder by id (see reminder_list).",
      riskLevel: "safe",
      parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      async execute(_ctx, args) {
        return { ok: await services.reminders.cancel(String(args.id ?? "")) };
      },
    }),
  );
}
