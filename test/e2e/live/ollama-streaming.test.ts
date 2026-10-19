import { it, expect, afterEach } from "vitest";
import { llmHarnessPlugin } from "@yggdrasil/harness-llm";
import openaiCompatPlugin from "@yggdrasil/provider-openai-compat";
import {
  createOllamaLiveConfig,
  GatewayWsClient,
  liveDescribe,
  LIVE_TEST_TIMEOUT_MS,
} from "../../helpers/index.js";
import { allocatePort } from "../../helpers/ports.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initSessionStore, resetSessionStoreForTest } from "@yggdrasil/sessions";
import { bootstrapKernel, disposeKernel, resetKernelForTest, resetRegistryForTest } from "@yggdrasil/kernel";
import { registerBuiltinHarnesses } from "@yggdrasil/harness-runtime";
import { startGatewayServer } from "@yggdrasil/gateway";

liveDescribe("ollama live streaming", () => {
  let sessionDir: string;
  let server: Awaited<ReturnType<typeof startGatewayServer>> | undefined;
  let gatewayPort: number;

  afterEach(async () => {
    if (server) await server.close();
    await disposeKernel();
    resetSessionStoreForTest();
    if (sessionDir) await rm(sessionDir, { recursive: true, force: true });
  });

  it(
    "emits chat.delta events during live chat.send",
    async () => {
      resetRegistryForTest();
      resetKernelForTest();
      resetSessionStoreForTest();
      registerBuiltinHarnesses();

      sessionDir = await mkdtemp(join(tmpdir(), "yggdrasil-live-stream-"));
      gatewayPort = await allocatePort();
      const config = createOllamaLiveConfig(sessionDir, gatewayPort, undefined, {
        harness: { streaming: true, maxToolIterations: 4 },
      });
      initSessionStore(config);

      await bootstrapKernel({
        config,
        workspaceRoot: process.cwd(),
        bundledPlugins: [openaiCompatPlugin, llmHarnessPlugin],
      });

      server = await startGatewayServer({ config, startChannels: false });

      const client = new GatewayWsClient();
      await client.connect(`ws://127.0.0.1:${gatewayPort}`);

      const { result, events } = await client.call<{ reply: string }>(
        "chat.send",
        {
          message: "Cuenta del 1 al 3 en una línea.",
          channelId: "gateway",
          sessionKey: "gateway:default:live-stream",
        },
        { collectEvents: true, timeoutMs: LIVE_TEST_TIMEOUT_MS },
      );

      const deltas = events.filter((e) => e.event === "chat.delta");
      expect(result.reply.length).toBeGreaterThan(0);
      expect(deltas.length).toBeGreaterThan(0);
      client.close();
    },
    LIVE_TEST_TIMEOUT_MS,
  );
});
