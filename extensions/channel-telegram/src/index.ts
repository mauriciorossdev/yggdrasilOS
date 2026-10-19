import { buildSessionKey } from "@yggdrasil/config";
import {
  defineChannelEntry,
  definePlugin,
  type ChannelGatewayStartContext,
  type ChannelPlugin,
  type NormalizedInboundMessage,
  type OutboundContext,
} from "@yggdrasil/sdk";
import {
  parseChatIdFromSessionKey,
  sleep,
  telegramGetUpdates,
  telegramSendMessage,
} from "./telegram.js";

export type TelegramAccountConfig = {
  botToken?: string;
  pollingIntervalMs?: number;
  allowedChatIds?: number[];
};

type PollingState = {
  running: boolean;
};

const pollingStates = new Map<string, PollingState>();
const accountTokens = new Map<string, string>();

function accountKey(accountId: string): string {
  return `telegram:${accountId}`;
}

function resolveBotToken(accountCfg: TelegramAccountConfig): string | undefined {
  return accountCfg.botToken?.trim() || process.env.TELEGRAM_BOT_TOKEN?.trim() || undefined;
}

function isChatAllowed(chatId: number, allowed?: number[]): boolean {
  if (!allowed?.length) return true;
  return allowed.includes(chatId);
}

async function runPollingLoop(
  ctx: ChannelGatewayStartContext,
  botToken: string,
  accountCfg: TelegramAccountConfig,
): Promise<void> {
  const key = accountKey(ctx.accountId);
  pollingStates.set(key, { running: true });
  accountTokens.set(ctx.accountId, botToken);

  let offset = 0;
  const intervalMs = accountCfg.pollingIntervalMs ?? 1000;

  while (!ctx.abortSignal.aborted && pollingStates.get(key)?.running) {
    try {
      const updates = await telegramGetUpdates(botToken, offset, 25);
      for (const update of updates) {
        offset = update.update_id + 1;
        const message = update.message;
        if (!message?.text?.trim()) continue;

        const chatId = message.chat.id;
        if (!isChatAllowed(chatId, accountCfg.allowedChatIds)) continue;

        const senderId = String(chatId);
        const inbound: NormalizedInboundMessage = {
          channelId: "telegram",
          accountId: ctx.accountId,
          sessionKey: buildSessionKey("telegram", ctx.accountId, senderId),
          senderId,
          body: message.text.trim(),
          timestamp: Date.now(),
          metadata: { telegramMessageId: message.message_id },
        };

        await ctx.onInbound(inbound);
      }
    } catch (err) {
      if (ctx.abortSignal.aborted) break;
      console.warn("[telegram] polling error:", err instanceof Error ? err.message : err);
    }

    try {
      await sleep(intervalMs, ctx.abortSignal);
    } catch {
      break;
    }
  }

  pollingStates.delete(key);
}

const telegramChannel: ChannelPlugin = defineChannelEntry({
  id: "telegram",
  meta: { label: "Telegram", description: "Telegram Bot API channel (long polling)" },
  capabilities: { inbound: true, outbound: true },
  config: {
    listAccountIds() {
      return ["default"];
    },
    resolveAccount(accountId) {
      return { accountId };
    },
  },
  gateway: {
    async startAccount(ctx) {
      const accountCfg = (ctx.config ?? {}) as TelegramAccountConfig;
      const botToken = resolveBotToken(accountCfg);
      if (!botToken) {
        throw new Error("Telegram botToken required (config or TELEGRAM_BOT_TOKEN)");
      }

      const key = accountKey(ctx.accountId);
      if (pollingStates.get(key)?.running) return;

      accountTokens.set(ctx.accountId, botToken);
      void runPollingLoop(ctx, botToken, accountCfg);
    },

    async stopAccount(ctx) {
      const key = accountKey(ctx.accountId);
      const state = pollingStates.get(key);
      if (state) {
        state.running = false;
        pollingStates.delete(key);
      }
      // Keep bot token until loop exits so in-flight sendFinal can still deliver.
      setTimeout(() => accountTokens.delete(ctx.accountId), 500);
    },
  },
  outbound: {
    deliveryMode: "direct",
    async sendFinal(ctx: OutboundContext, final) {
      const botToken = accountTokens.get(ctx.accountId);
      if (!botToken) return;

      const chatId = parseChatIdFromSessionKey(ctx.sessionKey);
      if (!chatId) return;

      await telegramSendMessage(botToken, chatId, final.text);
    },
  },
});

const plugin = definePlugin({
  id: "channel-telegram",
  name: "Telegram Channel",
  version: "0.1.0",
  register(api) {
    api.registerChannel(telegramChannel);
    api.logger.info("registered channel", { id: "telegram" });
  },
});

export default plugin;
export { telegramChannel };
