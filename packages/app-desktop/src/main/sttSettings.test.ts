import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultSttSettings, loadSttSettings } from "./whisperSettings.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ygg-stt-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const store = (cloud: Record<string, string>) =>
  writeFile(join(dir, "desktop-settings.json"), JSON.stringify({ stt: { source: "cloud", cloud } }), "utf8");

describe("loadSttSettings", () => {
  it("drops a provider that is no longer offered, URL and key included", async () => {
    await store({ provider: "retired", baseUrl: "https://old.example.com/v1", model: "m", apiKey: "k" });
    expect(await loadSttSettings(dir)).toEqual(defaultSttSettings());
  });

  it("keeps a current provider as saved", async () => {
    const cloud = { provider: "custom", baseUrl: "http://localhost:5092/v1", model: "parakeet", apiKey: "k" };
    await store(cloud);
    expect((await loadSttSettings(dir)).cloud).toEqual(cloud);
  });
});
