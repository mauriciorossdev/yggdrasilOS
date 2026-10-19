import { createInterface, type Interface } from "node:readline";
import { buildSessionKey } from "@yggdrasil/config";
import { renderMarkdown } from "./markdown.js";
import type {
  ChannelGatewayStartContext,
  ChannelPlugin,
  NormalizedInboundMessage,
  OutboundContext,
} from "@yggdrasil/sdk";
import { definePlugin } from "@yggdrasil/sdk";
import { getSessionStore } from "@yggdrasil/sessions";

type PendingApproval = {
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
};

type TuiSession = {
  rl: Interface;
  accountId: string;
  onInbound: (message: NormalizedInboundMessage) => Promise<void>;
  outboundLines: string[];
  activeAgentId?: string;
  pendingApproval?: PendingApproval;
};

const sessions = new Map<string, TuiSession>();

function sessionKey(accountId: string): string {
  return `tui:${accountId}`;
}

const APPROVAL_TIMEOUT_MS = 60_000;

export function createTuiApprovalPrompt(): (toolName: string, args: Record<string, unknown>) => Promise<boolean> {
  return (toolName, args) => {
    const session = [...sessions.values()][0];
    if (!session) return Promise.resolve(false);

    if (streamingActive) {
      finishStreaming();
    }

    return new Promise<boolean>((resolve) => {
      const argsStr = JSON.stringify(args);
      process.stdout.write(`\n⚠ Approve tool ${toolName} with ${argsStr}? [y/N] `);

      const timer = setTimeout(() => {
        session.pendingApproval = undefined;
        process.stdout.write("(timeout → denied)\n");
        resolve(false);
      }, APPROVAL_TIMEOUT_MS);

      session.pendingApproval = { resolve, timer };
    });
  };
}

let streamingActive = false;
let lastStreamKey: string | undefined;
let streamingBuffer = "";
let streamingLineCount = 0;

function streamKey(ctx: OutboundContext): string {
  return `${ctx.channelId}:${ctx.accountId}:${ctx.sessionKey}`;
}

function clearStreamingDisplay(): void {
  if (streamingLineCount > 0) {
    process.stdout.write(`\x1b[${streamingLineCount}A\x1b[0J`);
  }
}

function renderStreaming(): void {
  const prefix = "… ";
  const lines = streamingBuffer.split("\n");
  const output = prefix + lines.join("\n  ");
  streamingLineCount = output.split("\n").length;
  process.stdout.write(output);
}

function finishStreaming(): string {
  const text = streamingBuffer;
  if (streamingLineCount > 0) {
    clearStreamingDisplay();
  }
  process.stdout.write(`→ ${renderMarkdown(text)}\n`);
  streamingActive = false;
  lastStreamKey = undefined;
  streamingBuffer = "";
  streamingLineCount = 0;
  return text;
}

function printOutbound(ctx: OutboundContext, text: string, streaming = false): void {
  const key = streamKey(ctx);
  if (streaming) {
    if (!streamingActive) {
      streamingBuffer = "";
      streamingLineCount = 0;
    } else if (lastStreamKey !== key) {
      finishStreaming();
      streamingBuffer = "";
      streamingLineCount = 0;
    } else {
      clearStreamingDisplay();
    }
    streamingBuffer += text;
    streamingActive = true;
    lastStreamKey = key;
    renderStreaming();
    return;
  }
  if (streamingActive && lastStreamKey === key) {
    finishStreaming();
    return;
  }
  process.stdout.write(`→ ${renderMarkdown(text)}\n`);
}

export const tuiChannel: ChannelPlugin = {
  id: "tui",
  meta: { label: "Terminal", order: 0, description: "Interactive terminal channel" },
  capabilities: { inbound: true, outbound: true, streaming: true, interactive: true },
  config: {
    listAccountIds() {
      return ["default"];
    },
    resolveAccount(accountId) {
      return { accountId };
    },
  },
  gateway: {
    async startAccount(ctx: ChannelGatewayStartContext): Promise<void> {
      const key = sessionKey(ctx.accountId);
      if (sessions.has(key)) return;

      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
        prompt: "yggdrasil> ",
      });

      const session: TuiSession = {
        rl,
        accountId: ctx.accountId,
        onInbound: ctx.onInbound,
        outboundLines: [],
      };
      sessions.set(key, session);

      process.stdout.write("\nYggdrasil TUI — escribe un mensaje (/reset limpia sesión, Ctrl+C para salir)\n");
      rl.prompt();

      rl.on("line", async (line) => {
        if (session.pendingApproval) {
          const answer = line.trim().toLowerCase();
          clearTimeout(session.pendingApproval.timer);
          const { resolve } = session.pendingApproval;
          session.pendingApproval = undefined;
          resolve(answer === "y");
          return;
        }

        const body = line.trim();
        if (!body) {
          rl.prompt();
          return;
        }
        if (body === "/exit" || body === "/quit") {
          ctx.abortSignal.dispatchEvent(new Event("abort"));
          return;
        }

        const chatSessionKey = buildSessionKey("tui", ctx.accountId, "local-user");

        if (body === "/reset") {
          const store = getSessionStore();
          if (store) {
            await store.reset(chatSessionKey);
            process.stdout.write("→ Sesión reiniciada.\n");
          } else {
            process.stdout.write("→ Session store no disponible.\n");
          }
          rl.prompt();
          return;
        }

        if (body.startsWith("/agent ")) {
          const newAgentId = body.slice("/agent ".length).trim();
          if (newAgentId) {
            session.activeAgentId = newAgentId;
            process.stdout.write(`→ Agente activo: ${newAgentId}\n`);
          } else {
            process.stdout.write("→ Uso: /agent <id>\n");
          }
          rl.prompt();
          return;
        }

        const metadata: Record<string, unknown> = {};
        if (session.activeAgentId) metadata.agentId = session.activeAgentId;

        const message: NormalizedInboundMessage = {
          channelId: "tui",
          accountId: ctx.accountId,
          sessionKey: chatSessionKey,
          senderId: "local-user",
          body,
          timestamp: Date.now(),
          metadata: Object.keys(metadata).length ? metadata : undefined,
        };

        try {
          await session.onInbound(message);
        } catch (err) {
          process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
        }
        rl.prompt();
      });

      ctx.abortSignal.addEventListener("abort", () => {
        rl.close();
        sessions.delete(key);
      });
    },

    async stopAccount(ctx): Promise<void> {
      const key = sessionKey(ctx.accountId);
      const session = sessions.get(key);
      if (session) {
        session.rl.close();
        sessions.delete(key);
      }
    },
  },
  outbound: {
    deliveryMode: "direct",
    async sendText(ctx, text) {
      printOutbound(ctx, text);
    },
    async sendBlock(ctx, block) {
      printOutbound(ctx, block.text, true);
    },
    async sendFinal(ctx, final) {
      if (streamingActive && lastStreamKey === streamKey(ctx)) {
        finishStreaming();
      } else {
        printOutbound(ctx, final.text);
      }
    },
  },
};

export const tuiPlugin = definePlugin({
  id: "tui",
  name: "TUI Channel",
  version: "0.1.0",
  register(api) {
    api.registerChannel(tuiChannel);
  },
});

export default tuiPlugin;