import { defineTool } from "@yggdrasil/tools-sdk";
import { callDesktopControl, DesktopControlUnavailableError } from "./paneControlClient.js";

type PermissionsResponse = { screen: string; accessibility: string };
type FrontmostResponse = { app: string | null };
type OpenAppResponse = { opened: boolean; frontmost: string | null; becameFrontmost: boolean };
type ScreenshotResponse = {
  base64: string;
  mimeType: string;
  width: number;
  height: number;
  suspectBlank: boolean;
  windowMatchFailed?: boolean;
  note?: string;
};

export const desktopPermissionsTool = defineTool({
  name: "desktop_permissions",
  description:
    "Reports the current macOS permission state (Screen Recording, Accessibility) for Yggdrasil Desktop. " +
    "Use before desktop_screenshot if you're unsure whether it will work, or when the user asks why a desktop action failed.",
  riskLevel: "safe",
  parameters: { type: "object", properties: {} },
  async execute() {
    try {
      const result = await callDesktopControl<PermissionsResponse>("GET", "/desktop/permissions");
      return { available: true, ...result };
    } catch (err) {
      if (err instanceof DesktopControlUnavailableError) return { available: false };
      throw err;
    }
  },
});

export const desktopFrontmostTool = defineTool({
  name: "desktop_frontmost",
  description: "Returns the name of the application currently in the foreground on the user's Mac.",
  riskLevel: "safe",
  parameters: { type: "object", properties: {} },
  async execute() {
    const result = await callDesktopControl<FrontmostResponse>("GET", "/desktop/frontmost");
    return result;
  },
});

export const desktopOpenAppTool = defineTool({
  name: "desktop_open_app",
  description:
    "Opens (or brings to the foreground) a native application on the user's Mac, e.g. \"Microsoft Teams\". " +
    "Waits briefly for it to become the frontmost app. Does not click or type anything inside it.",
  riskLevel: "safe",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Application name as it appears in /Applications, e.g. \"Microsoft Teams\"" },
      waitFrontMs: {
        type: "number",
        description: "How long to wait for the app to become frontmost, in ms. Default 3000.",
      },
    },
    required: ["name"],
  },
  async execute(_ctx, args) {
    const name = String(args.name ?? "").trim();
    if (!name) throw new Error("name is required");
    const waitFrontMs = typeof args.waitFrontMs === "number" ? args.waitFrontMs : undefined;
    return callDesktopControl<OpenAppResponse>("POST", "/desktop/open-app", { name, waitFrontMs });
  },
});

export const desktopNotifyTool = defineTool({
  name: "desktop_notify",
  description: "Shows a native macOS notification to the user.",
  riskLevel: "safe",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string" },
      body: { type: "string" },
    },
    required: ["title", "body"],
  },
  async execute(_ctx, args) {
    const title = String(args.title ?? "");
    const body = String(args.body ?? "");
    if (!title) throw new Error("title is required");
    await callDesktopControl("POST", "/desktop/notify", { title, body });
    return { ok: true };
  },
});

export const desktopScreenshotTool = defineTool({
  name: "desktop_screenshot",
  // moderate: this reads the actual contents of the user's screen, not just
  // an app's on/off state — see notes/automation/workflows-design.md §4.
  riskLevel: "moderate",
  description:
    "Captures a screenshot of the user's screen or of one named app's window, and shows it to you. " +
    "For mode=\"window\", this opens/focuses `app` itself as part of this same call — do NOT call " +
    "desktop_open_app first. Calling it first would run unprompted before the user even sees the " +
    "approval request for this capture, instead of the user's one approval covering the whole " +
    "\"open + capture\" action as a single step. " +
    "Requires the user to have granted Yggdrasil Desktop the macOS Screen Recording permission — if not granted, " +
    "this fails with a permission_required error instead of returning a blank image.",
  parameters: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["screen", "window"],
        description: "\"screen\" captures the whole display; \"window\" captures one app's window (needs `app`).",
      },
      app: {
        type: "string",
        description: "App name to match when mode is \"window\", e.g. \"Microsoft Teams\".",
      },
    },
    required: ["mode"],
  },
  async execute(_ctx, args) {
    const mode = args.mode === "window" ? "window" : "screen";
    const app = typeof args.app === "string" ? args.app : undefined;
    const result = await callDesktopControl<ScreenshotResponse>("POST", "/desktop/screenshot", { mode, app });
    // __ygg_image__ sentinel — tool-loop.ts detects it and injects the image
    // as a multimodal user message on the next turn (same contract as
    // extensions/tool-image's image_view tool). tool-loop's own `[Image
    // loaded: ${path}]` fallback is repurposed here to surface the blank-
    // capture heuristic (workflows-design.md §5.8) — the permission check
    // already blocks the known silent-wallpaper case server-side, this is
    // defense-in-depth for the rest.
    const notes: string[] = [];
    if (result.note) notes.push(result.note);
    if (result.suspectBlank) {
      notes.push("warning: this capture looks blank/flat — verify Screen Recording permission and that the target app is visible");
    }

    return {
      __ygg_image__: true,
      base64: result.base64,
      mimeType: result.mimeType,
      path: notes.length ? notes.join(" ") : undefined,
      width: result.width,
      height: result.height,
      suspectBlank: result.suspectBlank,
      windowMatchFailed: result.windowMatchFailed,
    };
  },
});

export const desktopTools = [
  desktopPermissionsTool,
  desktopFrontmostTool,
  desktopOpenAppTool,
  desktopNotifyTool,
  desktopScreenshotTool,
];
