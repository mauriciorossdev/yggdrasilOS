import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Mock } from "vitest";

// readGlobalAgents() reads ~/.yggdrasil/agents.json — without this mock,
// tests that assert on exact agent lists leak whatever global agents
// happen to exist on the machine actually running the tests.
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: vi.fn() };
});

import { homedir } from "node:os";
import { mergeConfig, readConfigFile, readGlobalProviders, readRawConfigFile, writeConfigFile, writeGlobalProviders } from "@yggdrasil/config";
import { resetRegistryForTest, registerProvider } from "@yggdrasil/kernel";
import type { ProviderPlugin } from "@yggdrasil/sdk";
import { invokeGatewayMethod } from "./server.js";

describe("config gateway methods", () => {
  beforeEach(async () => {
    const home = await mkdtemp(join(tmpdir(), "ygg-home-cfg-gw-"));
    (homedir as unknown as Mock).mockReturnValue(home);
  });

  it("config.get returns sanitized config", async () => {
    const root = await mkdtemp(join(tmpdir(), "ygg-cfg-gw-"));
    await writeConfigFile(root, {
      auth: { gateway: { apiKey: "secret" } },
      agents: [{ id: "default", provider: "builtin", model: "echo" }],
    });

    const config = mergeConfig({}, { agents: [{ id: "default", provider: "builtin", model: "echo" }] });

    const result = (await invokeGatewayMethod(
      "config.get",
      {},
      config,
      null,
      root,
    )) as { config: { auth?: { gateway?: { apiKey?: string } } } };

    expect(result.config.auth?.gateway?.apiKey).toBe("***");
  });

  it("config.patch writes allowed fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "ygg-cfg-patch-"));
    const config = mergeConfig(
      {},
      {
        agents: [{ id: "default", provider: "builtin", model: "echo" }],
        harness: { policy: "auto" },
      },
    );

    const result = (await invokeGatewayMethod(
      "config.patch",
      {
        harness: { policy: "pinned", pinnedId: "builtin-echo" },
        channels: { tui: { enabled: true } },
      },
      config,
      null,
      root,
    )) as { ok: boolean; requiresRestart: boolean; config: { harness?: { pinnedId?: string } } };

    expect(result.ok).toBe(true);
    expect(result.requiresRestart).toBe(false); // harness/channels are hot-reloadable
    expect(result.config.harness?.pinnedId).toBe("builtin-echo");
  });

  it("config.patch merges agents by id instead of replacing the array — doesn't drop an agent created via a different flow after the client's snapshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "ygg-cfg-patch-agents-"));
    // Simulate agents.create() (AgentManager) adding "extra" on disk after
    // some client already fetched its own config.get snapshot.
    await writeConfigFile(root, {
      agents: [
        { id: "default", provider: "builtin", model: "echo" },
        { id: "extra", provider: "builtin", model: "echo", systemPrompt: "created later" },
      ],
    });

    const config = mergeConfig({}, { agents: [{ id: "default", provider: "builtin", model: "echo" }] });

    // That stale client (e.g. Settings) only knows about "default" — and is
    // editing it — with no idea "extra" exists.
    const result = (await invokeGatewayMethod(
      "config.patch",
      { agents: [{ id: "default", provider: "openai-compat", model: "gpt-4o-mini" }] },
      config,
      null,
      root,
    )) as { ok: boolean; config: { agents?: Array<{ id: string; provider?: string }> } };

    const ids = result.config.agents?.map((a) => a.id).sort();
    expect(ids).toEqual(["default", "extra"]);
    expect(result.config.agents?.find((a) => a.id === "default")?.provider).toBe("openai-compat");
    expect(result.config.agents?.find((a) => a.id === "extra")).toBeDefined();
  });

  it("config.patch reports requiresRestart: false when only harness/providers/language/agents changed — those resolve live off the same ctx.config on every real turn", async () => {
    const root = await mkdtemp(join(tmpdir(), "ygg-cfg-patch-no-restart-"));
    const config = mergeConfig({}, {});

    const result = (await invokeGatewayMethod(
      "config.patch",
      {
        harness: { policy: "pinned", pinnedId: "builtin-echo" },
        providers: { ollama: { baseUrl: "http://192.168.1.50:11434" } },
        language: "Spanish",
      },
      config,
      null,
      root,
    )) as { ok: boolean; requiresRestart: boolean };

    expect(result.ok).toBe(true);
    expect(result.requiresRestart).toBe(false);
  });

  it("config.patch merges providers by id and field — editing one provider's baseUrl doesn't drop another provider's apiKey or that provider's own untouched fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "ygg-cfg-patch-providers-"));
    await writeConfigFile(root, {
      providers: {
        ollama: { defaultModel: "llama3" },
        "openai-compat": { apiKey: "sk-existing", baseUrl: "https://api.openai.com/v1" },
      },
    });

    const config = mergeConfig({}, {});

    const result = (await invokeGatewayMethod(
      "config.patch",
      { providers: { ollama: { baseUrl: "http://192.168.1.50:11434" } } },
      config,
      null,
      root,
    )) as {
      ok: boolean;
      config: { providers?: Record<string, { baseUrl?: string; apiKey?: string; defaultModel?: string }> };
    };

    expect(result.ok).toBe(true);
    expect(result.config.providers?.ollama?.baseUrl).toBe("http://192.168.1.50:11434");
    expect(result.config.providers?.ollama?.defaultModel).toBe("llama3");
    expect(result.config.providers?.["openai-compat"]?.baseUrl).toBe("https://api.openai.com/v1");
    expect(result.config.providers?.["openai-compat"]?.apiKey).toBe("***");
  });

  it("providers.list resolves config.providers.<id> (not just pluginConfig) — so a custom baseUrl is reflected in model listing", async () => {
    resetRegistryForTest();
    let receivedConfig: unknown;
    const provider: ProviderPlugin = {
      id: "mock-provider",
      label: "Mock",
      listModels: (opts) => {
        receivedConfig = opts?.config;
        return [{ id: "m1", label: "M1", provider: "mock-provider" }];
      },
      chatComplete: async () => ({ text: "x", model: "m1" }),
    };
    registerProvider(provider);

    // Same config shape config.patch would have just written to ctx.config
    // in the live gateway process (one shared context per process — see
    // createDefaultGatewayContext) — asserting on that shape directly here
    // since this test helper builds a fresh context per call.
    const config = mergeConfig(
      {},
      { providers: { "mock-provider": { baseUrl: "http://192.168.1.50:11434" } } },
    );

    await invokeGatewayMethod("providers.list", {}, config);

    expect((receivedConfig as { baseUrl?: string })?.baseUrl).toBe("http://192.168.1.50:11434");
  });

  it("providers.list isolates a failing provider instead of failing the whole response — an unreachable host must not block Settings from loading at all", async () => {
    resetRegistryForTest();
    const broken: ProviderPlugin = {
      id: "broken",
      label: "Broken",
      listModels: async () => {
        throw new Error("Ollama at http://192.168.100.255:11434 is unreachable");
      },
      chatComplete: async () => ({ text: "x", model: "m" }),
    };
    const healthy: ProviderPlugin = {
      id: "healthy",
      label: "Healthy",
      listModels: () => [{ id: "m1", label: "M1", provider: "healthy" }],
      chatComplete: async () => ({ text: "x", model: "m1" }),
    };
    registerProvider(broken);
    registerProvider(healthy);

    const config = mergeConfig({}, {});
    const result = (await invokeGatewayMethod("providers.list", {}, config)) as {
      providers: Array<{ id: string; models: unknown[]; error?: string }>;
    };

    const brokenEntry = result.providers.find((p) => p.id === "broken");
    const healthyEntry = result.providers.find((p) => p.id === "healthy");
    expect(brokenEntry?.models).toEqual([]);
    expect(brokenEntry?.error).toMatch(/unreachable/);
    expect(healthyEntry?.models).toEqual([{ id: "m1", label: "M1", provider: "healthy" }]);
  });

  it("saving what config.get returned never overwrites stored secrets with the mask (provider key, channel token, gateway key)", async () => {
    const root = await mkdtemp(join(tmpdir(), "ygg-cfg-mask-"));
    await writeConfigFile(root, {
      providers: { anthropic: { apiKey: "sk-ant-real" } },
      channels: { telegram: { enabled: true, accounts: { default: { botToken: "bot-real" } } } },
      auth: { gateway: { apiKey: "gw-real", required: true } },
    });
    const config = mergeConfig({}, {});

    const shown = (await invokeGatewayMethod("config.get", {}, config, null, root)) as {
      config: { providers: unknown; channels: unknown; auth: unknown };
    };
    expect(JSON.stringify(shown)).not.toContain("sk-ant-real");

    // A settings form saves everything it loaded.
    await invokeGatewayMethod(
      "config.patch",
      { providers: shown.config.providers, channels: shown.config.channels, auth: shown.config.auth },
      config,
      null,
      root,
    );

    const { config: onDisk } = await readConfigFile(root);
    expect(onDisk.providers?.anthropic?.apiKey).toBe("sk-ant-real");
    expect((onDisk.channels?.telegram?.accounts as Record<string, { botToken?: string }>).default?.botToken).toBe("bot-real");
    expect(onDisk.auth?.gateway?.apiKey).toBe("gw-real");
  });

  describe("global providers (notes/features/global-providers.md)", () => {
    type Result = {
      config: { providers?: Record<string, { baseUrl?: string; apiKey?: string; defaultModel?: string }> };
      providerSources: Record<string, Record<string, string>>;
    };

    it("config.patch saves providers globally and drops those fields from the project", async () => {
      const root = await mkdtemp(join(tmpdir(), "ygg-cfg-global-"));
      await writeConfigFile(root, { providers: { ollama: { baseUrl: "http://lan:11434", defaultModel: "llama3" } } });

      const result = (await invokeGatewayMethod(
        "config.patch",
        { providers: { ollama: { baseUrl: "https://ollama.com", apiKey: "k1" } } },
        mergeConfig({}, {}),
        null,
        root,
      )) as Result;

      expect(await readGlobalProviders()).toEqual({ ollama: { baseUrl: "https://ollama.com", apiKey: "k1" } });
      expect((await readRawConfigFile(root)).providers).toEqual({ ollama: { defaultModel: "llama3" } });
      expect(result.config.providers?.ollama).toEqual({ baseUrl: "https://ollama.com", apiKey: "***", defaultModel: "llama3" });
      expect(result.providerSources.ollama).toMatchObject({ baseUrl: "global", apiKey: "global", defaultModel: "project" });
    });

    it("config.patch with providersScope project leaves the global file alone", async () => {
      const root = await mkdtemp(join(tmpdir(), "ygg-cfg-global-"));
      await writeGlobalProviders({ ollama: { baseUrl: "https://ollama.com" } });

      await invokeGatewayMethod(
        "config.patch",
        { providersScope: "project", providers: { ollama: { baseUrl: "http://lan:11434" } } },
        mergeConfig({}, {}),
        null,
        root,
      );

      expect(await readGlobalProviders()).toEqual({ ollama: { baseUrl: "https://ollama.com" } });
      expect((await readRawConfigFile(root)).providers).toEqual({ ollama: { baseUrl: "http://lan:11434" } });
    });

    it("config.get shows another project's global save", async () => {
      const a = await mkdtemp(join(tmpdir(), "ygg-cfg-global-a-"));
      const b = await mkdtemp(join(tmpdir(), "ygg-cfg-global-b-"));
      await invokeGatewayMethod("config.patch", { providers: { ollama: { defaultModel: "gemma" } } }, mergeConfig({}, {}), null, a);

      const result = (await invokeGatewayMethod("config.get", {}, mergeConfig({}, {}), null, b)) as Result;
      expect(result.config.providers?.ollama?.defaultModel).toBe("gemma");
      expect(result.providerSources.ollama?.defaultModel).toBe("global");
    });

    it("providers.scope moves a project's own values to global, or just drops them", async () => {
      const root = await mkdtemp(join(tmpdir(), "ygg-cfg-global-"));
      await writeConfigFile(root, { providers: { "openai-compat": { baseUrl: "https://ollama.com/v1", defaultModel: "gemma" } } });

      const moved = (await invokeGatewayMethod("providers.scope", { id: "openai-compat", action: "moveToGlobal" }, mergeConfig({}, {}), null, root)) as Result;
      expect(await readGlobalProviders()).toEqual({ "openai-compat": { baseUrl: "https://ollama.com/v1", defaultModel: "gemma" } });
      expect((await readRawConfigFile(root)).providers).toBeUndefined();
      expect(moved.providerSources["openai-compat"]).toMatchObject({ baseUrl: "global", defaultModel: "global" });

      await writeConfigFile(root, { providers: { "openai-compat": { defaultModel: "qwen" } } });
      await invokeGatewayMethod("providers.scope", { id: "openai-compat", action: "useGlobal" }, mergeConfig({}, {}), null, root);
      expect((await readRawConfigFile(root)).providers).toBeUndefined();
      expect((await readGlobalProviders())["openai-compat"]?.defaultModel).toBe("gemma");
    });
  });
});
