import { UnsupportedPlatformError, type DesktopAutomationAdapter } from "./types.js";

/**
 * Win32/Linux stub for phase 1 (notes/automation/workflows-design.md phase 7
 * is where real adapters land — desktopCapturer works cross-platform, but
 * the permission model and app-launch mechanics need their own per-OS
 * research, not a guess baked in here). getPermissions() reports
 * "unsupported" rather than throwing so /desktop/permissions can still
 * render a clear status in the UI instead of erroring the whole panel.
 */
export function createUnsupportedAutomationAdapter(platform: NodeJS.Platform): DesktopAutomationAdapter {
  const unsupported = (action: string) => {
    throw new UnsupportedPlatformError(action, platform);
  };
  return {
    platform,
    async getPermissions() {
      return { screen: "unsupported", accessibility: "unsupported" };
    },
    async requestPermission() {
      unsupported("requestPermission");
    },
    async getFrontmostApp() {
      unsupported("getFrontmostApp");
      return null;
    },
    async openApp() {
      return unsupported("openApp") as never;
    },
    async screenshot() {
      return unsupported("screenshot") as never;
    },
    async notify() {
      unsupported("notify");
    },
  };
}
