import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Mock } from "vitest";

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: vi.fn() };
});

import { homedir } from "node:os";
import {
  applyProviderEdits,
  mergeProviderSources,
  projectOwnProviders,
  readGlobalProviders,
  removeProviderFields,
  resolveGlobalProvidersPath,
  writeGlobalProviders,
} from "./global-providers.js";
import { readEffectiveConfig, readRawConfigFile, writeConfigFile } from "./file.js";

const DEFAULTS = { "openai-compat": { baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini" } };

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), "ygg-home-"));
  (homedir as unknown as Mock).mockReturnValue(home);
});

describe("global providers file", () => {
  it("is empty when missing or malformed", async () => {
    expect(await readGlobalProviders()).toEqual({});
    await writeGlobalProviders({ ollama: { apiKey: "k" } });
    await writeFile(resolveGlobalProvidersPath(), "not json", "utf8");
    expect(await readGlobalProviders()).toEqual({});
  });

  it("round-trips and is readable only by the owner", async () => {
    await writeGlobalProviders({ ollama: { apiKey: "k", baseUrl: "https://ollama.com" } });
    expect(await readGlobalProviders()).toEqual({ ollama: { apiKey: "k", baseUrl: "https://ollama.com" } });
    expect((await stat(resolveGlobalProvidersPath())).mode & 0o777).toBe(0o600);
  });
});

describe("applyProviderEdits", () => {
  it("sets, clears with an empty string, and leaves absent fields alone", () => {
    const current = { ollama: { apiKey: "old", baseUrl: "https://a" } };
    expect(applyProviderEdits(current, { ollama: { apiKey: "new", baseUrl: "" } })).toEqual({ ollama: { apiKey: "new" } });
    expect(current.ollama.apiKey).toBe("old");
  });

  it("drops a provider left with no fields", () => {
    expect(applyProviderEdits({ ollama: { apiKey: "k" } }, { ollama: { apiKey: "" } })).toEqual({});
    expect(removeProviderFields({ ollama: { apiKey: "k", defaultModel: "m" } }, { ollama: ["apiKey"] })).toEqual({
      ollama: { defaultModel: "m" },
    });
  });
});

describe("projectOwnProviders", () => {
  it("ignores the copied built-in defaults but keeps what differs", () => {
    expect(projectOwnProviders({ "openai-compat": DEFAULTS["openai-compat"] }, DEFAULTS)).toEqual({});
    expect(
      projectOwnProviders({ "openai-compat": { baseUrl: "https://ollama.com/v1", defaultModel: "gpt-4o-mini" } }, DEFAULTS),
    ).toEqual({ "openai-compat": { baseUrl: "https://ollama.com/v1" } });
  });
});

describe("mergeProviderSources", () => {
  it("resolves each field as defaults < global < project and says where it came from", () => {
    const { providers, sources } = mergeProviderSources(
      DEFAULTS,
      { "openai-compat": { baseUrl: "https://ollama.com/v1", apiKey: "g" } },
      { "openai-compat": { defaultModel: "gemma" } },
      {},
    );
    expect(providers["openai-compat"]).toEqual({ baseUrl: "https://ollama.com/v1", apiKey: "g", defaultModel: "gemma" });
    expect(sources["openai-compat"]).toEqual({ baseUrl: "global", apiKey: "global", defaultModel: "project" });
  });

  it("marks a key that only an env var provides", () => {
    const { sources } = mergeProviderSources({}, { ollama: { baseUrl: "https://ollama.com" } }, {}, { OLLAMA_API_KEY: "x" });
    expect(sources.ollama).toEqual({ baseUrl: "global", apiKey: "env" });
  });
});

describe("project config file", () => {
  it("doesn't copy the default providers into the project when saving something else", async () => {
    const root = await mkdtemp(join(tmpdir(), "ygg-proj-"));
    await writeConfigFile(root, { defaultAgent: "plan" });
    expect((await readRawConfigFile(root)).providers).toBeUndefined();
  });

  it("drops an old copy of the defaults on the next save, keeping real project values", async () => {
    const root = await mkdtemp(join(tmpdir(), "ygg-proj-"));
    await writeFile(
      join(root, "yggdrasil.config.json"),
      JSON.stringify({ providers: { "openai-compat": DEFAULTS["openai-compat"], ollama: { defaultModel: "llama" } } }),
    );
    await writeConfigFile(root, { defaultAgent: "plan" });
    expect(JSON.parse(await readFile(join(root, "yggdrasil.config.json"), "utf8")).providers).toEqual({
      ollama: { defaultModel: "llama" },
    });
  });

  it("runs with the global providers unless the project set its own", async () => {
    const root = await mkdtemp(join(tmpdir(), "ygg-proj-"));
    await writeGlobalProviders({ "openai-compat": { baseUrl: "https://ollama.com/v1", defaultModel: "gemma" } });
    await writeFile(
      join(root, "yggdrasil.config.json"),
      JSON.stringify({ providers: { "openai-compat": { ...DEFAULTS["openai-compat"], defaultModel: "qwen" } } }),
    );
    const { config, providerSources } = await readEffectiveConfig(root);
    expect(config.providers?.["openai-compat"]).toEqual({ baseUrl: "https://ollama.com/v1", defaultModel: "qwen" });
    expect(providerSources["openai-compat"]).toMatchObject({ baseUrl: "global", defaultModel: "project" });
  });
});
