import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadTtsSettings } from "./piperSettings.js";
import { loadSttSettings } from "./whisperSettings.js";

describe("stored cloud voice providers", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "avatar-settings-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const store = (settings: unknown) => writeFile(join(dir, "avatar-settings.json"), JSON.stringify(settings));
  const old = { provider: "retired", baseUrl: "https://api.example.com/v1", apiKey: "key-for-retired", model: "m" };

  it("drops a provider that is no longer offered, with its URL and key", async () => {
    await store({ stt: { source: "cloud", cloud: old }, tts: { source: "local", cloud: { ...old, voiceId: "v" } } });
    const stt = await loadSttSettings(dir);
    expect(stt.cloud).toMatchObject({ provider: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "" });
    const tts = await loadTtsSettings(dir);
    expect(tts.source).toBe("local");
    expect(tts.cloud).toMatchObject({ provider: "minimax", apiKey: "", voiceId: "" });
  });

  it("keeps a provider that is still offered", async () => {
    const kept = { provider: "custom", baseUrl: "https://voice.example.com/v1", apiKey: "k", model: "m" };
    await store({ stt: { source: "cloud", cloud: kept } });
    expect((await loadSttSettings(dir)).cloud).toEqual(kept);
  });
});
