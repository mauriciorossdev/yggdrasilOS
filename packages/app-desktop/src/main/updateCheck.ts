import { app, BrowserWindow, ipcMain, net, shell } from "electron";
import {
  DEFAULT_RELEASES_URL,
  RELEASE_PAGE_PREFIX,
  isNewerVersion,
  parseLatestRelease,
  type AvailableUpdate,
} from "./updateCheckCore.js";

/**
 * "A new version is available" notice. Asks the GitHub releases API for the
 * latest stable desktop release and, when it's newer than this build, tells
 * every window so it can show a banner whose button opens the release page.
 * Nothing is downloaded or installed; that's electron-updater's job
 * (autoUpdate.ts), and only when YGGDRASIL_UPDATE_URL is set.
 *
 * Runs only in packaged builds. Environment:
 *   YGGDRASIL_UPDATE_CHECK=0        never check
 *   YGGDRASIL_UPDATE_CHECK=1        also check in dev (`pnpm desktop`)
 *   YGGDRASIL_UPDATE_CHECK_URL=...  ask another endpoint with the same JSON shape
 */

const FIRST_CHECK_DELAY_MS = 10_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

let available: AvailableUpdate | null = null;
let dismissed = false;

function enabled(): boolean {
  const flag = process.env.YGGDRASIL_UPDATE_CHECK?.trim();
  if (flag === "0") return false;
  // electron-updater already handles updates from that feed.
  if (process.env.YGGDRASIL_UPDATE_URL?.trim()) return false;
  return app.isPackaged || flag === "1";
}

function broadcast(): void {
  const payload = dismissed ? null : available;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("update:available", payload);
  }
}

async function check(): Promise<void> {
  const url = process.env.YGGDRASIL_UPDATE_CHECK_URL?.trim() || DEFAULT_RELEASES_URL;
  try {
    const res = await net.fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `Yggdrasil-Desktop/${app.getVersion()}`,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    // 403/429 (rate limit), 404 (no release yet): try again next round.
    if (!res.ok) {
      console.warn(`[updateCheck] ${url} answered ${res.status}`);
      return;
    }
    const latest = parseLatestRelease(await res.json());
    if (!latest || !isNewerVersion(latest.version, app.getVersion())) return;
    if (latest.version === available?.version) return;
    available = latest;
    dismissed = false;
    broadcast();
  } catch (error) {
    console.warn("[updateCheck] check failed", error instanceof Error ? error.message : error);
  }
}

export function installUpdateCheck(): void {
  ipcMain.handle("update:get", () => (dismissed ? null : available));
  // No URL argument on purpose: it only opens the page main fetched itself.
  ipcMain.handle("update:openRelease", async () => {
    if (available?.url.startsWith(RELEASE_PAGE_PREFIX)) await shell.openExternal(available.url);
  });
  // "Later": hidden in every window until the app restarts or a newer version appears.
  ipcMain.handle("update:dismiss", () => {
    dismissed = true;
    broadcast();
  });

  if (!enabled()) return;
  setTimeout(() => void check(), FIRST_CHECK_DELAY_MS);
  setInterval(() => void check(), CHECK_INTERVAL_MS).unref?.();
}
