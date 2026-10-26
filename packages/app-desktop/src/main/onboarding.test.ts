import { describe, expect, it } from "vitest";
import { CLI_CATALOG, detectClis, parseVersion } from "./cliDetect.js";
import { detectOllama, parseOllamaTags } from "./ollamaDetect.js";
import {
  defaultOnboardingSettings,
  sanitizeOnboarding,
  shouldAutoOpenOnboarding,
} from "./onboardingSettings.js";

describe("parseVersion", () => {
  it("pulls the first dotted version out of --version output", () => {
    expect(parseVersion("2.1.4 (Claude Code)")).toBe("2.1.4");
    expect(parseVersion("copilot version v0.0.350\n")).toBe("0.0.350");
    expect(parseVersion("agy 1.2")).toBe("1.2");
    expect(parseVersion("1.0.0-beta.2 build")).toBe("1.0.0-beta.2");
  });

  it("returns undefined when there is no version", () => {
    expect(parseVersion("")).toBeUndefined();
    expect(parseVersion("usage: omp [options]")).toBeUndefined();
  });
});

describe("detectClis", () => {
  it("reports every catalog CLI, installed ones with path and version", async () => {
    const found: Record<string, string> = { claude: "C:\\bin\\claude.exe", omp: "C:\\bin\\omp.cmd" };
    const result = await detectClis({
      locate: async (cmd) => found[cmd] ?? null,
      runVersion: async (path) => (path.includes("claude") ? "2.1.4 (Claude Code)" : null),
    });

    expect(result.map((c) => c.id)).toEqual(CLI_CATALOG.map((c) => c.id));
    expect(result.find((c) => c.id === "claude")).toMatchObject({ installed: true, version: "2.1.4", path: "C:\\bin\\claude.exe" });
    // found on PATH but --version failed: still installed, just no version
    const omp = result.find((c) => c.id === "omp");
    expect(omp?.installed).toBe(true);
    expect(omp).not.toHaveProperty("version");
    expect(result.find((c) => c.id === "copilot")).toMatchObject({ installed: false });
    expect(result.find((c) => c.id === "copilot")).not.toHaveProperty("path");
  });
});

describe("parseOllamaTags", () => {
  it("returns model names and ignores malformed entries", () => {
    expect(parseOllamaTags({ models: [{ name: "llama3.2:3b" }, { name: "qwen2.5-coder:7b" }, {}, null, { name: "" }] })).toEqual([
      "llama3.2:3b",
      "qwen2.5-coder:7b",
    ]);
    expect(parseOllamaTags(null)).toEqual([]);
    expect(parseOllamaTags({ models: "nope" })).toEqual([]);
  });
});

describe("detectOllama", () => {
  it("running server implies installed and lists models", async () => {
    const status = await detectOllama({ locate: async () => null, fetchTags: async () => ({ models: [{ name: "llama3.2" }] }) });
    expect(status).toEqual({ installed: true, running: true, models: ["llama3.2"] });
  });

  it("binary present but server down: installed, not running", async () => {
    const status = await detectOllama({
      locate: async () => "C:\\ollama.exe",
      fetchTags: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect(status).toEqual({ installed: true, running: false, models: [] });
  });

  it("nothing found", async () => {
    const status = await detectOllama({
      locate: async () => null,
      fetchTags: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect(status).toEqual({ installed: false, running: false, models: [] });
  });
});

describe("sanitizeOnboarding", () => {
  it("returns defaults for garbage", () => {
    expect(sanitizeOnboarding(undefined)).toEqual(defaultOnboardingSettings());
    expect(sanitizeOnboarding("x")).toEqual(defaultOnboardingSettings());
  });

  it("drops unknown CLI ids and usage modes but keeps an empty list distinct from null", () => {
    const s = sanitizeOnboarding({
      completedAt: "2026-10-22T00:00:00.000Z",
      version: 1,
      language: "es",
      enabledHarnesses: ["claude", "bogus", "copilot"],
      usage: ["cli", "nope", "local"],
      showAllClis: true,
    });
    expect(s).toEqual({
      completedAt: "2026-10-22T00:00:00.000Z",
      version: 1,
      language: "es",
      enabledHarnesses: ["claude", "copilot"],
      usage: ["cli", "local"],
      showAllClis: true,
    });
    expect(sanitizeOnboarding({ enabledHarnesses: [] }).enabledHarnesses).toEqual([]);
    expect(sanitizeOnboarding({}).enabledHarnesses).toBeNull();
  });
});

describe("shouldAutoOpenOnboarding", () => {
  it("opens on a fresh install", () => {
    expect(shouldAutoOpenOnboarding(defaultOnboardingSettings(), false)).toBe(true);
  });

  it("does not open once completed, nor for installs that were already configured", () => {
    expect(shouldAutoOpenOnboarding({ ...defaultOnboardingSettings(), completedAt: "2026-10-22T00:00:00.000Z" }, false)).toBe(false);
    expect(shouldAutoOpenOnboarding(defaultOnboardingSettings(), true)).toBe(false);
  });
});
