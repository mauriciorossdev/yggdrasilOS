import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { app } from "electron";

const LOG_FILE = "main-crashes.log";

function formatEntry(kind: string, detail: unknown): string {
  const text = detail instanceof Error ? (detail.stack ?? detail.message) : JSON.stringify(detail);
  return `[${new Date().toISOString()}] ${kind}: ${text}\n`;
}

export function logPath(): string {
  return join(app.getPath("logs"), LOG_FILE);
}

async function appendCrashLog(entry: string): Promise<void> {
  await mkdir(app.getPath("logs"), { recursive: true });
  await appendFile(logPath(), entry, "utf8");
}

/** For call sites that already catch an error themselves (e.g. startup failure shown in a dialog) and want it in the same log as everything else. */
export function logCaughtError(kind: string, error: unknown): void {
  void appendCrashLog(formatEntry(kind, error));
}

/**
 * Without this, an uncaught error in the main process crashes the whole app
 * with no trace anywhere a real user could find — unacceptable once this
 * ships outside a dev machine with a terminal attached. Deliberately logs
 * only the error's own message/stack, not surrounding app state, so this
 * never becomes a channel for dumping project/session content to disk.
 *
 * uncaughtException/unhandledRejection only cover JS throws in *this*
 * process — a renderer crash (OOM, a native module segfault) or a GPU/utility
 * process crash exits silently through neither of those, which is what left
 * the log empty the one time this actually mattered. render-process-gone and
 * child-process-gone are the corresponding native-crash hooks.
 */
export function installCrashLogging(): void {
  console.log(`[main] crash log: ${logPath()}`);

  process.on("uncaughtException", (error) => {
    void appendCrashLog(formatEntry("uncaughtException", error));
    console.error("[main] uncaughtException", error);
  });

  process.on("unhandledRejection", (reason) => {
    void appendCrashLog(formatEntry("unhandledRejection", reason));
    console.error("[main] unhandledRejection", reason);
  });

  app.on("render-process-gone", (_event, webContents, details) => {
    const info = { url: webContents.getURL(), ...details };
    void appendCrashLog(formatEntry("render-process-gone", info));
    console.error("[main] render-process-gone", info);
  });

  app.on("child-process-gone", (_event, details) => {
    void appendCrashLog(formatEntry("child-process-gone", details));
    console.error("[main] child-process-gone", details);
  });
}
