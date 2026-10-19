import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { systemPreferences, desktopCapturer, screen, Notification } from "electron";
import { isBitmapLikelyBlank, frontmostMatchesRequestedApp, pickCaptureSource } from "./heuristics.js";
import {
  PermissionRequiredError,
  type DesktopAutomationAdapter,
  type DesktopPermissions,
  type NotifyOptions,
  type OpenAppResult,
  type PermissionKind,
  type PermissionState,
  type ScreenshotOptions,
  type ScreenshotResult,
} from "./types.js";

const execFileAsync = promisify(execFile);

const SYSTEM_SETTINGS_PANE: Record<PermissionKind, string> = {
  screen: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
};

function toPermissionState(status: "not-determined" | "granted" | "denied" | "restricted" | "unknown"): PermissionState {
  return status === "unknown" ? "not-determined" : status;
}

/**
 * `lsappinfo front` + `lsappinfo info` instead of AppleScript's `tell
 * application "System Events" to name of first process whose frontmost is
 * true` — the AppleScript route sends an Apple Event, which needs the
 * Automation TCC permission (and an NSAppleEventsUsageDescription entry) on
 * a packaged, signed app. `lsappinfo` needs neither — see the spike findings
 * in notes/automation/workflows-design.md §1.
 */
async function getFrontmostAppName(): Promise<string | null> {
  try {
    const { stdout: front } = await execFileAsync("lsappinfo", ["front"]);
    const asn = front.trim();
    if (!asn) return null;
    // `lsappinfo info <asn>` (no -only filter) starts its output with the
    // app's display name, quoted, e.g. `"Cursor" ASN:0x0-0xc00c: (in front)`.
    // `-only name` looked tidier but doesn't actually key its output as
    // "name" — it's "LSDisplayName" — so a regex anchored on "name"= never
    // matched anything and this always returned null. Verified against a
    // real running app before fixing.
    const { stdout: info } = await execFileAsync("lsappinfo", ["info", asn]);
    const match = info.match(/^"([^"]+)"/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function createDarwinAutomationAdapter(): DesktopAutomationAdapter {
  return {
    platform: "darwin",

    async getPermissions(): Promise<DesktopPermissions> {
      return {
        screen: toPermissionState(systemPreferences.getMediaAccessStatus("screen")),
        accessibility: systemPreferences.isTrustedAccessibilityClient(false) ? "granted" : "denied",
      };
    },

    async requestPermission(kind: PermissionKind): Promise<void> {
      // macOS has no programmatic re-prompt for Screen Recording once it's
      // been denied once — System Settings is the only path. Deep-link
      // straight to the right pane instead of leaving the user to find it.
      await execFileAsync("open", [SYSTEM_SETTINGS_PANE[kind]]);
    },

    async getFrontmostApp(): Promise<string | null> {
      return getFrontmostAppName();
    },

    async openApp(name: string, waitFrontMs = 3000): Promise<OpenAppResult> {
      // `open -a` only, deliberately — no `osascript ... activate`. The
      // spike found `activate` does bring an already-running app forward
      // more reliably, but it's an Apple Event and needs the Automation
      // permission on a signed build; `open -a` needs none. Revisit once
      // phase 7 adds signing + NSAppleEventsUsageDescription.
      await execFileAsync("open", ["-a", name]);

      const deadline = Date.now() + Math.max(0, waitFrontMs);
      let frontmost: string | null = null;
      // Poll instead of one fixed sleep — the spike saw Teams still not
      // frontmost 3s after `open -a` returned when it was a fresh launch.
      for (;;) {
        frontmost = await getFrontmostAppName();
        if (frontmostMatchesRequestedApp(frontmost, name)) break;
        if (Date.now() >= deadline) break;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      return { opened: true, frontmost, becameFrontmost: frontmostMatchesRequestedApp(frontmost, name) };
    },

    async screenshot(options: ScreenshotOptions): Promise<ScreenshotResult> {
      // The one check that actually prevents the silent-wallpaper bug from
      // the spike — everything past this line assumes the OS will hand back
      // real screen content, not a blank stand-in.
      const status = systemPreferences.getMediaAccessStatus("screen");
      if (status !== "granted") throw new PermissionRequiredError("screen");

      const display = screen.getPrimaryDisplay();
      const thumbnailSize = {
        width: Math.round(display.size.width * display.scaleFactor),
        height: Math.round(display.size.height * display.scaleFactor),
      };
      const sources = await desktopCapturer.getSources({
        types: options.mode === "window" ? ["window"] : ["screen"],
        thumbnailSize,
      });

      const { source, error } = pickCaptureSource(sources, options.mode, options.app);
      if (error) throw new Error(error);
      if (!source) throw new Error("no_capture_source_available");

      const image = source.thumbnail;
      const size = image.getSize();
      const suspectBlank = isBitmapLikelyBlank(image.toBitmap(), size.width, size.height);

      return {
        base64: image.toPNG().toString("base64"),
        mimeType: "image/png",
        width: size.width,
        height: size.height,
        suspectBlank,
      };
    },

    async notify({ title, body }: NotifyOptions): Promise<void> {
      if (!Notification.isSupported()) throw new Error("notifications_not_supported");
      new Notification({ title, body }).show();
    },
  };
}
