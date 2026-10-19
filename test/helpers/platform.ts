import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_CONFIG, mergeConfig, type YggdrasilConfig } from "@yggdrasil/config";
import type { YggdrasilPlugin } from "@yggdrasil/sdk";
import {
  bootstrapKernel,
  disposeKernel,
  resetKernelForTest,
  resetRegistryForTest,
} from "@yggdrasil/kernel";
import { registerBuiltinHarnesses } from "@yggdrasil/harness-runtime";
import { llmHarnessPlugin } from "@yggdrasil/harness-llm";
import openaiCompatPlugin from "@yggdrasil/provider-openai-compat";
import echoPlugin from "../../extensions/echo-channel/src/index.ts";
import { httpChannelPlugin } from "@yggdrasil/channel-http";
import { initSessionStore, resetSessionStoreForTest, type SessionStore } from "@yggdrasil/sessions";
import { invokeGatewayMethod, startGatewayServer, type GatewayServer } from "@yggdrasil/gateway";
import { allocatePorts } from "./ports.js";

export type TestPlatform = {
  config: YggdrasilConfig;
  store: SessionStore;
  server?: GatewayServer;
  gatewayPort: number;
  httpPort?: number;
  sessionDir: string;
  invoke: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  close: () => Promise<void>;
};

export type CreateTestPlatformOptions = {
  bundledPlugins?: YggdrasilPlugin[];
  startServer?: boolean;
  startChannels?: boolean;
  withEchoChannel?: boolean;
  withHttpChannel?: boolean;
  withLlmPlugins?: boolean;
  configOverride?: Partial<YggdrasilConfig>;
  workspaceRoot?: string;
};

export async function createTestPlatform(
  options: CreateTestPlatformOptions = {},
): Promise<TestPlatform> {
  resetRegistryForTest();
  resetKernelForTest();
  resetSessionStoreForTest();
  registerBuiltinHarnesses();

  const sessionDir = await mkdtemp(join(tmpdir(), "yggdrasil-test-"));
  const needHttp = options.withHttpChannel ?? false;
  const [gatewayPort, httpPort] = await allocatePorts(needHttp ? 2 : 1);

  const bundledPlugins: YggdrasilPlugin[] = [...(options.bundledPlugins ?? [])];

  if (options.withEchoChannel !== false && options.withLlmPlugins !== false) {
    if (!bundledPlugins.some((p) => p.id === "echo-channel")) {
      bundledPlugins.push(echoPlugin);
    }
  }
  if (options.withLlmPlugins !== false) {
    if (!bundledPlugins.some((p) => p.id === "provider-openai-compat")) {
      bundledPlugins.push(openaiCompatPlugin);
    }
    if (!bundledPlugins.some((p) => p.id === "harness-llm")) {
      bundledPlugins.push(llmHarnessPlugin);
    }
  }
  if (needHttp && !bundledPlugins.some((p) => p.id === "channel-http")) {
    bundledPlugins.push(httpChannelPlugin);
  }

  const config = mergeConfig(DEFAULT_CONFIG, {
    gateway: { port: gatewayPort, host: "127.0.0.1" },
    sessions: { dir: sessionDir },
    agents: [{ id: "default", provider: "builtin", model: "echo" }],
    channels: needHttp
      ? {
          http: { enabled: true, accounts: { default: { port: httpPort, host: "127.0.0.1" } } },
          tui: { enabled: false },
          echo: { enabled: false },
          telegram: { enabled: false },
        }
      : {
          tui: { enabled: false },
          echo: { enabled: false },
          telegram: { enabled: false },
        },
    ...options.configOverride,
  });

  const store = initSessionStore(config);
  const workspaceRoot = options.workspaceRoot ?? process.cwd();

  await bootstrapKernel({
    config,
    workspaceRoot,
    bundledPlugins,
  });

  let server: GatewayServer | undefined;
  if (options.startServer) {
    server = await startGatewayServer({
      config,
      workspaceRoot,
      startChannels: options.startChannels ?? false,
    });
  }

  const invoke = (method: string, params: Record<string, unknown> = {}) =>
    invokeGatewayMethod(method, params, config, store, workspaceRoot);

  const close = async () => {
    if (server) {
      await server.close();
    }
    await disposeKernel();
    resetSessionStoreForTest();
    await rm(sessionDir, { recursive: true, force: true });
  };

  return {
    config,
    store,
    server,
    gatewayPort,
    httpPort: needHttp ? httpPort : undefined,
    sessionDir,
    invoke,
    close,
  };
}
