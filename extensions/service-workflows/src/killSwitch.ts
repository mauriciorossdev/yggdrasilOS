import { readFile } from "node:fs/promises";

/**
 * Reads the desktop app's own desktop-settings.json directly (plain fs, no
 * Electron API) — YGGDRASIL_DESKTOP_SETTINGS_PATH is set by
 * packages/app-desktop/src/main/gateway.ts when this gateway was spawned by
 * the desktop app; unset when run standalone (`yggdrasil run`, CI, etc.),
 * where there's no kill switch UI at all, so automation is never paused.
 * Only Electron main ever writes this file — see automationSettings.ts.
 */
export async function isAutomationPaused(): Promise<boolean> {
  const path = process.env.YGGDRASIL_DESKTOP_SETTINGS_PATH;
  if (!path) return false;
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as { automation?: { paused?: boolean } };
    return raw.automation?.paused === true;
  } catch {
    return false; // missing/corrupt file — fail open, not paused
  }
}
