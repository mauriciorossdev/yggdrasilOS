import { app } from "electron";
// electron-updater is CommonJS; Node's ESM loader can't reliably statically
// analyze its named exports (this app runs unpacked/real-ESM, no bundler
// rewriting the import), so it must come off the default export instead.
import electronUpdater from "electron-updater";
const { autoUpdater } = electronUpdater;

/**
 * Opt-in: updates are checked only when `YGGDRASIL_UPDATE_URL` points at a
 * generic feed (a folder serving the installers and `latest*.yml`). There is no
 * official update server, so without it this does nothing. Skipped entirely
 * outside a packaged build.
 *
 * On macOS this silently no-ops until the app is code-signed (Squirrel.Mac
 * refuses to apply updates to an unsigned bundle) — see `electron-builder.yml`
 * and the plan's pending-signing note. Windows/Linux update regardless.
 */
export function installAutoUpdater(): void {
  if (!app.isPackaged) return;
  const feedUrl = process.env.YGGDRASIL_UPDATE_URL?.trim();
  if (!feedUrl) return;

  autoUpdater.setFeedURL({ provider: "generic", url: feedUrl });
  autoUpdater.autoDownload = true;
  autoUpdater.on("error", (error) => {
    console.error("[autoUpdate] error", error);
  });

  void autoUpdater.checkForUpdatesAndNotify();
}
