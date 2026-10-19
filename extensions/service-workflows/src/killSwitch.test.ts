import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isAutomationPaused } from "./killSwitch.js";

describe("isAutomationPaused", () => {
  afterEach(() => {
    delete process.env.YGGDRASIL_DESKTOP_SETTINGS_PATH;
  });

  it("is false when the env var isn't set (non-desktop usage)", async () => {
    expect(await isAutomationPaused()).toBe(false);
  });

  it("is false when the file doesn't exist yet", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ygg-killswitch-"));
    process.env.YGGDRASIL_DESKTOP_SETTINGS_PATH = join(dir, "desktop-settings.json");
    expect(await isAutomationPaused()).toBe(false);
  });

  it("is false when automation.paused is absent or false", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ygg-killswitch-"));
    const path = join(dir, "desktop-settings.json");
    await writeFile(path, JSON.stringify({ ide: { configuredId: "vscode" } }));
    process.env.YGGDRASIL_DESKTOP_SETTINGS_PATH = path;
    expect(await isAutomationPaused()).toBe(false);
  });

  it("is true when automation.paused is true", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ygg-killswitch-"));
    const path = join(dir, "desktop-settings.json");
    await writeFile(path, JSON.stringify({ automation: { paused: true } }));
    process.env.YGGDRASIL_DESKTOP_SETTINGS_PATH = path;
    expect(await isAutomationPaused()).toBe(true);
  });

  it("fails open (false) on a corrupt file rather than throwing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ygg-killswitch-"));
    const path = join(dir, "desktop-settings.json");
    await writeFile(path, "{not json");
    process.env.YGGDRASIL_DESKTOP_SETTINGS_PATH = path;
    expect(await isAutomationPaused()).toBe(false);
  });
});
