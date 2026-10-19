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

liveDescribe("ollama live compaction", () => {
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
    "summarize compaction after many turns and agent still responds",
    async () => {
      resetRegistryForTest();
      resetKernelForTest();
      resetSessionStoreForTest();
      registerBuiltinHarnesses();

      sessionDir = await mkdtemp(join(tmpdir(), "yggdrasil-live-compact-"));
      gatewayPort = await allocatePort();
      const config = createOllamaLiveConfig(sessionDir, gatewayPort, undefined, {
        sessions: {
          maxMessages: 50,
          compactThreshold: 6,
          compactionPolicy: "summarize",
        },
        harness: { streaming: false, maxToolIterations: 4, compactBeforeTurn: true },
      });
      initSessionStore(config);

      await bootstrapKernel({
        config,
        workspaceRoot: process.cwd(),
        bundledPlugins: [openaiCompatPlugin, llmHarnessPlugin],
      });

      server = await startGatewayServer({ config, startChannels: false });
      const sessionKey = "gateway:default:live-compact";
      const client = new GatewayWsClient();
      await client.connect(`ws://127.0.0.1:${gatewayPort}`);

      for (let i = 0; i < 7; i++) {
        await client.call(
          "chat.send",
          {
            message: `Turno ${i}: recuerda el número ${i}.`,
            channelId: "gateway",
            sessionKey,
          },
          { timeoutMs: LIVE_TEST_TIMEOUT_MS },
        );
      }

      const detail = (
        await client.call<{
          session: { compaction?: { lastCompactedAt?: number }; messages: unknown[] } | null;
        }>("sessions.get", { sessionKey })
      ).result;
      expect(detail.session?.compaction?.lastCompactedAt).toBeDefined();

      const { result } = await client.call<{ reply: string }>(
        "chat.send",
        {
          message: "Responde solo 'ok' si sigues funcionando.",
          channelId: "gateway",
          sessionKey,
        },
        { timeoutMs: LIVE_TEST_TIMEOUT_MS },
      );
      expect(result.reply.length).toBeGreaterThan(0);
      client.close();
    },
    LIVE_TEST_TIMEOUT_MS * 8,
  );

  it(
    "tool call works after compaction",
    async () => {
      resetRegistryForTest();
      resetKernelForTest();
      resetSessionStoreForTest();
      registerBuiltinHarnesses();

      sessionDir = await mkdtemp(join(tmpdir(), "yggdrasil-live-compact-tool-"));
      gatewayPort = await allocatePort();
      const config = createOllamaLiveConfig(sessionDir, gatewayPort, undefined, {
        sessions: {
          maxMessages: 50,
          compactThreshold: 4,
          compactionPolicy: "summarize",
        },
        harness: { streaming: false, maxToolIterations: 6 },
      });
      initSessionStore(config);

      await bootstrapKernel({
        config,
        workspaceRoot: process.cwd(),
        bundledPlugins: [openaiCompatPlugin, llmHarnessPlugin],
      });

      server = await startGatewayServer({ config, startChannels: false });
      const sessionKey = "gateway:default:live-compact-tool";
      const client = new GatewayWsClient();
      await client.connect(`ws://127.0.0.1:${gatewayPort}`);

      for (let i = 0; i < 5; i++) {
        await client.call(
          "chat.send",
          { message: `Mensaje ${i}`, channelId: "gateway", sessionKey },
          { timeoutMs: LIVE_TEST_TIMEOUT_MS },
        );
      }

      const { result } = await client.call<{ reply: string }>(
        "chat.send",
        {
          message:
            'Usa la herramienta echo con message "post-compact". Debes llamar a la herramienta.',
          channelId: "gateway",
          sessionKey,
        },
        { timeoutMs: LIVE_TEST_TIMEOUT_MS },
      );
      expect(result.reply.length).toBeGreaterThan(0);
      client.close();
    },
    LIVE_TEST_TIMEOUT_MS * 6,
  );
});
