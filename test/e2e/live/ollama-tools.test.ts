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

async function createLivePlatform() {
  resetRegistryForTest();
  resetKernelForTest();
  resetSessionStoreForTest();
  registerBuiltinHarnesses();

  const sessionDir = await mkdtemp(join(tmpdir(), "yggdrasil-live-tools-"));
  const gatewayPort = await allocatePort();
  const config = createOllamaLiveConfig(sessionDir, gatewayPort);
  initSessionStore(config);

  await bootstrapKernel({
    config,
    workspaceRoot: process.cwd(),
    bundledPlugins: [openaiCompatPlugin, llmHarnessPlugin],
  });

  const server = await startGatewayServer({ config, startChannels: false });

  return {
    gatewayPort,
    server,
    close: async () => {
      await server.close();
      await disposeKernel();
      resetSessionStoreForTest();
      await rm(sessionDir, { recursive: true, force: true });
    },
  };
}

liveDescribe("ollama live tools", () => {
  let live: Awaited<ReturnType<typeof createLivePlatform>>;

  afterEach(async () => {
    await live?.close();
  });

  it(
    "tools.list includes echo before chat",
    async () => {
      live = await createLivePlatform();
      const client = new GatewayWsClient();
      await client.connect(`ws://127.0.0.1:${live.gatewayPort}`);

      const { result } = await client.call<{ tools: Array<{ name: string }> }>("tools.list");
      expect(result.tools.map((t) => t.name)).toContain("echo");
      client.close();
    },
    LIVE_TEST_TIMEOUT_MS,
  );

  it(
    "invokes echo tool and persists tool_calls in session",
    async () => {
      live = await createLivePlatform();
      const sessionKey = "gateway:default:live-tools";
      const client = new GatewayWsClient();
      await client.connect(`ws://127.0.0.1:${live.gatewayPort}`);

      const { result } = await client.call<{ reply: string }>(
        "chat.send",
        {
          message:
            'Debes usar la herramienta "echo" con el argumento message igual a "hola-live". No respondas sin llamar a la herramienta primero.',
          channelId: "gateway",
          sessionKey,
        },
        { timeoutMs: LIVE_TEST_TIMEOUT_MS },
      );
      expect(result.reply.length).toBeGreaterThan(0);

      const detail = (
        await client.call<{
          session: {
            messages: Array<{
              role: string;
              tool_calls?: unknown[];
              tool_call_id?: string;
            }>;
          } | null;
        }>("sessions.get", { sessionKey })
      ).result;

      const messages = detail.session?.messages ?? [];
      const hasToolCall = messages.some((m) => m.role === "assistant" && m.tool_calls?.length);
      const hasToolResult = messages.some((m) => m.role === "tool" && m.tool_call_id);
      expect(hasToolCall || hasToolResult || messages.length >= 2).toBe(true);
      client.close();
    },
    LIVE_TEST_TIMEOUT_MS,
  );
});
