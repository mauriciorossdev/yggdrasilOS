import { join } from "node:path";
import { app } from "electron";
import { readSettingsFile, updateSettingsFile } from "./settingsFile.js";

/**
 * Kill switch (workflows-design.md §6.1/§6.4) — when `paused`, the gateway
 * subprocess refuses to run ANY workflow, manual or triggered (see
 * extensions/service-workflows/src/killSwitch.ts, which reads this same
 * desktop-settings.json file directly via YGGDRASIL_DESKTOP_SETTINGS_PATH,
 * since that subprocess has no Electron `app` API of its own).
 */
export type AutomationSettings = { paused: boolean };

export function defaultAutomationSettings(): AutomationSettings {
  return { paused: false };
}

/** desktop-settings.json also holds automation's settings (nested under "automation") — see settingsFile.ts's shared write queue. */
export async function loadAutomationSettings(userDataDir: string): Promise<AutomationSettings> {
  const raw = await readSettingsFile(userDataDir);
  return { ...defaultAutomationSettings(), ...((raw as { automation?: Partial<AutomationSettings> }).automation ?? {}) };
}

export async function saveAutomationSettings(userDataDir: string, settings: AutomationSettings): Promise<void> {
  await updateSettingsFile(userDataDir, (existing) => ({ ...existing, automation: settings }));
}

/** The literal path handed to the gateway subprocess as YGGDRASIL_DESKTOP_SETTINGS_PATH — must match settingsFile.ts's own `settingsPath()`, which isn't exported (it's an internal filename detail of that module), so this is kept in sync by hand. */
export function desktopSettingsFilePath(): string {
  return join(app.getPath("userData"), "desktop-settings.json");
}

/** Per-project workflow runs/grants/scheduler-state — always under Electron's userData, never inside the project's own repo (workflows-design.md §2.4's "grants, runs y artifacts son siempre locales"). */
export function workflowStateDir(projectId: string): string {
  return join(app.getPath("userData"), "workflows", projectId);
}
