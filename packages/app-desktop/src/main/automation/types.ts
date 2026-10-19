export type PermissionState = "granted" | "denied" | "not-determined" | "restricted" | "unsupported";

export type DesktopPermissions = {
  screen: PermissionState;
  accessibility: PermissionState;
};

export type PermissionKind = "screen" | "accessibility";

export type OpenAppResult = {
  opened: boolean;
  frontmost: string | null;
  becameFrontmost: boolean;
};

export type ScreenshotOptions = {
  mode: "screen" | "window";
  app?: string;
};

export type ScreenshotResult = {
  base64: string;
  mimeType: string;
  width: number;
  height: number;
  /** Best-effort heuristic, not a hard guarantee — see isBitmapLikelyBlank. */
  suspectBlank: boolean;
};

export type NotifyOptions = { title: string; body: string };

/**
 * OS-specific implementation the /desktop/* routes in paneControlServer.ts
 * dispatch to. One instance per app run, picked by process.platform — see
 * ./index.ts. Only darwin.ts has a real implementation for v1
 * (notes/automation/workflows-design.md phase 1); win32/linux get the
 * unsupported stub until phase 7.
 */
export type DesktopAutomationAdapter = {
  platform: NodeJS.Platform;
  getPermissions(): Promise<DesktopPermissions>;
  /** Fire-and-forget — deep-links to the relevant System Settings pane; there's no programmatic re-prompt for a denied permission on macOS. */
  requestPermission(kind: PermissionKind): Promise<void>;
  getFrontmostApp(): Promise<string | null>;
  openApp(name: string, waitFrontMs?: number): Promise<OpenAppResult>;
  screenshot(options: ScreenshotOptions): Promise<ScreenshotResult>;
  notify(options: NotifyOptions): Promise<void>;
};

/** Thrown by the permission-checked path in screenshot() — paneControlServer.ts maps this to a 403 `permission_required` response, never a fake success. */
export class PermissionRequiredError extends Error {
  constructor(public readonly kind: PermissionKind) {
    super(`${kind} permission is required`);
    this.name = "PermissionRequiredError";
  }
}

export class UnsupportedPlatformError extends Error {
  constructor(action: string, platform: NodeJS.Platform) {
    super(`${action} is not supported on ${platform} yet`);
    this.name = "UnsupportedPlatformError";
  }
}
