import { it, expect, afterEach } from "vitest";
import { llmHarnessPlugin } from "@yggdrasil/harness-llm";
import openaiCompatPlugin from "@yggdrasil/provider-openai-compat";
import {
  createOllamaLiveConfig,
  GatewayWsClient,
  liveDescribe,
  LIVE_TEST_TIMEOUT_MS,
  postInbound,
} from "../../helpers/index.js";
import { allocatePorts } from "../../helpers/ports.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initSessionStore } from "@yggdrasil/sessions";
import { bootstrapKernel, disposeKernel } from "@yggdrasil/kernel";
import { registerBuiltinHarnesses } from "@yggdrasil/harness-runtime";
import { resetKernelForTest, resetRegistryForTest } from "@yggdrasil/kernel";
import { resetSessionStoreForTest } from "@yggdrasil/sessions";
import { startGatewayServer } from "@yggdrasil/gateway";
import { httpChannelPlugin } from "@yggdrasil/channel-http";

async function createLivePlatform(overrides?: Parameters<typeof createOllamaLiveConfig>[3]) {
  resetRegistryForTest();
  resetKernelForTest();
  resetSessionStoreForTest();
  registerBuiltinHarnesses();

  const sessionDir = await mkdtemp(join(tmpdir(), "yggdrasil-live-"));
  const [gatewayPort, httpPort] = await allocatePorts(2);
  const config = createOllamaLiveConfig(sessionDir, gatewayPort, httpPort, overrides);
  initSessionStore(config);

  await bootstrapKernel({
    config,
    workspaceRoot: process.cwd(),
    bundledPlugins: [openaiCompatPlugin, llmHarnessPlugin, httpChannelPlugin],
  });

  const server = await startGatewayServer({ config, startChannels: true });

  return {
    config,
    sessionDir,
    gatewayPort,
    httpPort,
    server,
    close: async () => {
      await server.close();
      await disposeKernel();
      resetSessionStoreForTest();
      await rm(sessionDir, { recursive: true, force: true });
    },
  };
}

liveDescribe("ollama live chat", () => {
  let live: Awaited<ReturnType<typeof createLivePlatform>>;

  afterEach(async () => {
    await live?.close();
  });

  it(
    "remembers context across multi-turn conversation",
    async () => {
      live = await createLivePlatform();
      const sessionKey = "gateway:default:live-memory";
      const client = new GatewayWsClient();
      await client.connect(`ws://127.0.0.1:${live.gatewayPort}`);

      await client.call(
        "chat.send",
        {
          message: "Mi color favorito es azul. Responde solo 'entendido'.",
          channelId: "gateway",
          sessionKey,
        },
        { timeoutMs: LIVE_TEST_TIMEOUT_MS },
      );

      const { result } = await client.call<{ reply: string }>(
        "chat.send",
        {
          message: "¿Cuál es mi color favorito? Responde en una palabra.",
          channelId: "gateway",
          sessionKey,
        },
        { timeoutMs: LIVE_TEST_TIMEOUT_MS },
      );

      expect(result.reply.length).toBeGreaterThan(0);
      expect(result.reply.toLowerCase()).toMatch(/azul/);
      client.close();
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  it(
    "gateway and HTTP share sessionKey with live LLM",
    async () => {
      live = await createLivePlatform();
      const sessionKey = "http:live:shared";
      const client = new GatewayWsClient();
      await client.connect(`ws://127.0.0.1:${live.gatewayPort}`);

      await client.call(
        "chat.send",
        { message: "Di hola en una palabra.", channelId: "gateway", sessionKey },
        { timeoutMs: LIVE_TEST_TIMEOUT_MS },
      );
      client.close();

      const httpRes = await postInbound(`http://127.0.0.1:${live.httpPort}`, {
        message: "Di adiós en una palabra.",
        sessionKey,
      });
      expect(httpRes.status).toBe(200);
      const body = httpRes.body as { reply: string };
      expect(body.reply.length).toBeGreaterThan(0);

      const wsClient = new GatewayWsClient();
      await wsClient.connect(`ws://127.0.0.1:${live.gatewayPort}`);
      const detail = (
        await wsClient.call<{
          session: { messages: unknown[] } | null;
        }>("sessions.get", { sessionKey })
      ).result;
      expect((detail.session?.messages ?? []).length).toBeGreaterThanOrEqual(4);
      wsClient.close();
    },
    LIVE_TEST_TIMEOUT_MS,
  );
});
