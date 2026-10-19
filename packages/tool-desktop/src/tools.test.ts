import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import type { ToolContext } from "@yggdrasil/tools-sdk";
import {
  desktopOpenAppTool,
  desktopScreenshotTool,
  desktopPermissionsTool,
  desktopNotifyTool,
  desktopTools,
} from "./tools.js";
import { DesktopControlError } from "./paneControlClient.js";

const ctx: ToolContext = { sessionKey: "test", config: {} };

function mockFetchOnce(body: unknown, ok = true, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({ ok, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  process.env.YGGDRASIL_PANE_CONTROL_URL = "http://127.0.0.1:12345";
  process.env.YGGDRASIL_PANE_CONTROL_TOKEN = "secret-token";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.YGGDRASIL_PANE_CONTROL_URL;
  delete process.env.YGGDRASIL_PANE_CONTROL_TOKEN;
});

describe("risk levels", () => {
  it("only desktop_screenshot requires approval — everything else is safe", () => {
    const risky = desktopTools.filter((t) => t.riskLevel !== "safe");
    expect(risky.map((t) => t.name)).toEqual(["desktop_screenshot"]);
    expect(desktopScreenshotTool.riskLevel).toBe("moderate");
    expect(desktopScreenshotTool.requiresApproval).toBe(true);
  });
});

describe("desktop_open_app tool", () => {
  it("requires a name", async () => {
    await expect(desktopOpenAppTool.execute(ctx, {})).rejects.toThrow("name is required");
  });

  it("posts the app name and forwards the response", async () => {
    mockFetchOnce({ opened: true, frontmost: "Microsoft Teams", becameFrontmost: true });
    const result = await desktopOpenAppTool.execute(ctx, { name: "Microsoft Teams" });
    expect(result).toEqual({ opened: true, frontmost: "Microsoft Teams", becameFrontmost: true });
  });
});

describe("desktop_screenshot tool", () => {
  it("returns an __ygg_image__ sentinel on success", async () => {
    mockFetchOnce({ base64: "abc123", mimeType: "image/png", width: 100, height: 100, suspectBlank: false });
    const result = (await desktopScreenshotTool.execute(ctx, { mode: "screen" })) as Record<string, unknown>;
    expect(result.__ygg_image__).toBe(true);
    expect(result.base64).toBe("abc123");
    expect(result.mimeType).toBe("image/png");
    expect(result.path).toBeUndefined();
  });

  it("flags a suspiciously blank capture via the path warning instead of silently succeeding", async () => {
    mockFetchOnce({ base64: "abc123", mimeType: "image/png", width: 100, height: 100, suspectBlank: true });
    const result = (await desktopScreenshotTool.execute(ctx, { mode: "screen" })) as Record<string, unknown>;
    expect(result.suspectBlank).toBe(true);
    expect(String(result.path)).toMatch(/blank/);
  });

  it("propagates permission_required instead of returning a fake success", async () => {
    mockFetchOnce({ error: "permission_required" }, false, 403);
    const err = await desktopScreenshotTool.execute(ctx, { mode: "screen" }).catch((e) => e);
    expect(err).toBeInstanceOf(DesktopControlError);
    expect((err as DesktopControlError).code).toBe("permission_required");
  });
});

describe("desktop_permissions tool", () => {
  it("reports available: false when the desktop control server isn't reachable", async () => {
    delete process.env.YGGDRASIL_PANE_CONTROL_URL;
    delete process.env.YGGDRASIL_PANE_CONTROL_TOKEN;
    const result = await desktopPermissionsTool.execute(ctx, {});
    expect(result).toEqual({ available: false });
  });

  it("reports the permission states when available", async () => {
    mockFetchOnce({ screen: "granted", accessibility: "denied" });
    const result = await desktopPermissionsTool.execute(ctx, {});
    expect(result).toEqual({ available: true, screen: "granted", accessibility: "denied" });
  });
});

describe("desktop_notify tool", () => {
  it("requires a title", async () => {
    await expect(desktopNotifyTool.execute(ctx, { body: "hi" })).rejects.toThrow("title is required");
  });
});
