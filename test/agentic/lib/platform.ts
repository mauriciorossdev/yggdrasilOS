import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, mergeConfig, type YggdrasilConfig } from "@yggdrasil/config";
import { bootstrapKernel, disposeKernel, resetKernelForTest, resetRegistryForTest } from "@yggdrasil/kernel";
import { registerBuiltinHarnesses } from "@yggdrasil/harness-runtime";
import { llmHarnessPlugin } from "@yggdrasil/harness-llm";
import { initSessionStore, resetSessionStoreForTest } from "@yggdrasil/sessions";
import { startGatewayServer, type GatewayServer } from "@yggdrasil/gateway";
import { ollamaPlugin } from "../../../packages/provider-ollama/src/index.ts";
import toolSystem from "../../../packages/tool-system/src/index.ts";
import toolFs from "../../../extensions/tool-fs/src/index.ts";
import toolShell from "../../../extensions/tool-shell/src/index.ts";
import toolSearch from "../../../extensions/tool-search/src/index.ts";
import toolFetch from "../../../extensions/tool-fetch/src/index.ts";
import { allocatePort } from "../../helpers/ports.js";
import { startFaultProxy, type Fault, type FaultProxy } from "./faultProxy.js";

export type EvalSettings = {
  model: string;
  ollamaUrl: string;
  /** The harness's maxToolIterations: how many model↔tool rounds one user message may take. */
  maxToolIterations: number;
  /** "auto" asks for risky tools, as the TUI does by default; the eval answers through its approval policy. */
  approvalMode: "auto" | "yolo";
  /** "tui" drives the real TUI (keyboard in, screen out) instead of calling the gateway directly. */
  driver?: "gateway" | "tui";
  /** harness.loopGuards; false measures the bare loop (to see what the guards add). */
  loopGuards?: boolean;
  /** providers.ollama.think: false turns off a thinking model's reasoning mode (see provider-ollama). Undefined = model default. */
  think?: boolean;
  /** Agent systemPrompt, to A/B a prompt line against the bare agent. Undefined = none. */
  systemPrompt?: string;
  /** Bearer token for Ollama Cloud. Kept in memory only: never written to the workspace, which the model can read. */
  apiKey?: string;
  /** Fail this share (0–1) of chat requests on purpose, through a proxy in front of ollamaUrl (see faultProxy.ts). */
  faultRate?: number;
  faults?: Fault[];
  faultSeed?: number;
  /** providers.ollama.maxRetries; 0 turns the provider's retrying off (to show what the faults do without it). */
  providerMaxRetries?: number;
};

export type AgenticPlatform = {
  workspace: string;
  sandboxRoot: string;
  gatewayPort: number;
  url: string;
  config: YggdrasilConfig;
  /** Present when faults are being injected. */
  faultStats?: () => { chatRequests: number; injected: number };
  close: () => Promise<void>;
};

const authHeader = (apiKey?: string): Record<string, string> => (apiKey ? { Authorization: `Bearer ${apiKey}` } : {});

export type ReachResult = { ok: boolean; status?: number };

export async function ollamaReachable(url: string, apiKey?: string): Promise<ReachResult> {
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/api/tags`, { headers: authHeader(apiKey), signal: AbortSignal.timeout(5000) });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false };
  }
}

/** Capabilities Ollama reports for a model ("completion", "tools", "thinking"…), or null when it is not pulled. */
export async function ollamaModelCapabilities(url: string, model: string, apiKey?: string): Promise<string[] | null> {
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/api/show`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeader(apiKey) },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { capabilities?: string[] };
    return body.capabilities ?? [];
  } catch {
    return null;
  }
}

/**
 * A real gateway (same kernel, harness, providers and tools the TUI talks to) rooted in a throwaway
 * directory. The process cwd is moved into the workspace for the scenario, because tools such as
 * run_command and write_file resolve relative paths against it — exactly as when the CLI is started
 * from a project folder.
 *
 * Deliberately not loaded: the memory plugins (their sqlite binary may be built for Electron) and
 * connectors that need credentials.
 */
export async function createAgenticPlatform(settings: EvalSettings): Promise<AgenticPlatform> {
  resetRegistryForTest();
  resetKernelForTest();
  resetSessionStoreForTest();
  registerBuiltinHarnesses();

  // realpath: on macOS tmpdir() is a symlink, and the policy compares resolved paths.
  const sandboxRoot = await realpath(await mkdtemp(join(tmpdir(), "ygg-agentic-")));
  const workspace = join(sandboxRoot, "workspace");
  const sessionDir = join(sandboxRoot, "sessions");
  await mkdir(workspace, { recursive: true });
  await mkdir(sessionDir, { recursive: true });

  // Chaos mode: the provider talks to a proxy that fails some chat requests; everything else is forwarded.
  let faultProxy: FaultProxy | undefined;
  if (settings.faultRate && settings.faultRate > 0) {
    faultProxy = await startFaultProxy({ upstream: settings.ollamaUrl, rate: settings.faultRate, faults: settings.faults, seed: settings.faultSeed });
  }
  const providerUrl = faultProxy?.url ?? settings.ollamaUrl;

  const gatewayPort = await allocatePort();
  // The gateway lists agents from the project's config file, so write the same agent there
  // (otherwise the TUI shows the default model while the turns run on the one under test).
  await writeFile(
    join(workspace, "yggdrasil.config.json"),
    JSON.stringify({
      agents: [{ id: "default", provider: "ollama", model: settings.model, ...(settings.systemPrompt ? { systemPrompt: settings.systemPrompt } : {}) }],
      providers: { ollama: { baseUrl: providerUrl, defaultModel: settings.model, ...(settings.think !== undefined ? { think: settings.think } : {}) } },
      defaultAgent: "default",
    }),
  );
  const config = mergeConfig(DEFAULT_CONFIG, {
    gateway: { port: gatewayPort, host: "127.0.0.1" },
    sessions: { dir: sessionDir },
    agents: [{ id: "default", provider: "ollama", model: settings.model, ...(settings.systemPrompt ? { systemPrompt: settings.systemPrompt } : {}) }],
    providers: { ollama: { baseUrl: providerUrl, defaultModel: settings.model, ...(settings.think !== undefined ? { think: settings.think } : {}), ...(settings.apiKey ? { apiKey: settings.apiKey } : {}), ...(settings.providerMaxRetries !== undefined ? { maxRetries: settings.providerMaxRetries } : {}) } },
    harness: { streaming: true, maxToolIterations: settings.maxToolIterations, policy: "auto", loopGuards: settings.loopGuards ?? true },
    channels: { tui: { enabled: false }, http: { enabled: false }, echo: { enabled: false }, telegram: { enabled: false } },
  });

  const previousCwd = process.cwd();
  process.chdir(workspace);
  initSessionStore(config);
  await bootstrapKernel({
    config,
    workspaceRoot: workspace,
    bundledPlugins: [ollamaPlugin, llmHarnessPlugin, toolSystem, toolFs, toolShell, toolSearch, toolFetch],
  });
  const server: GatewayServer = await startGatewayServer({ config, workspaceRoot: workspace, startChannels: false });

  return {
    workspace,
    sandboxRoot,
    gatewayPort,
    url: `ws://127.0.0.1:${gatewayPort}`,
    config,
    faultStats: faultProxy ? () => faultProxy!.stats() : undefined,
    close: async () => {
      await server.close();
      await faultProxy?.close();
      await disposeKernel();
      resetSessionStoreForTest();
      process.chdir(previousCwd);
      if (!process.env.EVAL_KEEP) await rm(sandboxRoot, { recursive: true, force: true });
    },
  };
}
