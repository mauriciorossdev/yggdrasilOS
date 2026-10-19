import { App } from "@slack/bolt";
import { buildSessionKey } from "@yggdrasil/config";
import type {
  ChannelPlugin,
  NormalizedInboundMessage,
  OutboundContext,
  OutboundFinal,
} from "@yggdrasil/sdk";

type SlackAccountConfig = {
  botToken?: string;
  appToken?: string;
  allowedChannelIds?: string[];
};

type AccountState = {
  app: App;
};

const accountStates = new Map<string, AccountState>();

function resolveTokens(
  cfg: SlackAccountConfig,
  accountId: string,
): { botToken: string; appToken: string } {
  const botToken = cfg.botToken?.trim() || process.env.SLACK_BOT_TOKEN?.trim();
  const appToken = cfg.appToken?.trim() || process.env.SLACK_APP_TOKEN?.trim();
  if (!botToken) {
    throw new Error(
      `Slack botToken required (config or SLACK_BOT_TOKEN) for account ${accountId}`,
    );
  }
  if (!appToken) {
    throw new Error(
      `Slack appToken required (config or SLACK_APP_TOKEN) for account ${accountId} — needed for Socket Mode`,
    );
  }
  return { botToken, appToken };
}

export function parseChannelId(sessionKey: string): string | undefined {
  const parts = sessionKey.split(":");
  if (parts.length < 3 || parts[0] !== "slack") return undefined;
  return parts.slice(2).join(":");
}

export const slackChannel: ChannelPlugin = {
  id: "slack",
  meta: { label: "Slack", order: 21, description: "Slack bot channel (Socket Mode)" },
  capabilities: {
    inbound: true,
    outbound: true,
    streaming: false,
    interactive: false,
  },

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
      const pluginCfg = ctx.globalConfig as Record<string, unknown> | undefined;
      const channelsCfg = pluginCfg?.channels as Record<string, unknown> | undefined;
      const slackCfg = channelsCfg?.slack as Record<string, unknown> | undefined;
      const accounts = slackCfg?.accounts as Record<string, SlackAccountConfig> | undefined;
      const accountCfg: SlackAccountConfig = accounts?.[ctx.accountId] ?? {};

      const { botToken, appToken } = resolveTokens(accountCfg, ctx.accountId);
      const allowedChannelIds = accountCfg.allowedChannelIds ?? [];

      const app = new App({
        token: botToken,
        appToken,
        socketMode: true,
      });

      app.message(async ({ message }) => {
        // Only handle regular user messages (no subtypes = no edits/joins/etc)
        if (!("user" in message) || !message.user) return;
        if ("bot_id" in message && message.bot_id) return;
        if ("subtype" in message && message.subtype) return;

        const channelId = message.channel;
        if (allowedChannelIds.length > 0 && !allowedChannelIds.includes(channelId)) return;

        const text = "text" in message ? (message.text ?? "") : "";
        if (!text.trim()) return;

        const sessionKey = buildSessionKey("slack", ctx.accountId, channelId);
        const inbound: NormalizedInboundMessage = {
          channelId: "slack",
          accountId: ctx.accountId,
          sessionKey,
          senderId: message.user,
          body: text,
          timestamp: message.ts ? Math.floor(Number(message.ts) * 1000) : Date.now(),
        };

        ctx.onInbound(inbound).catch((err: unknown) => {
          console.error("[channel-slack] onInbound error:", err);
        });
      });

      ctx.abortSignal.addEventListener("abort", () => {
        void app.stop().catch(() => undefined);
        accountStates.delete(ctx.accountId);
      });

      await app.start();
      accountStates.set(ctx.accountId, { app });
    },

    async stopAccount(ctx) {
      const state = accountStates.get(ctx.accountId);
      if (state) {
        await state.app.stop().catch(() => undefined);
        accountStates.delete(ctx.accountId);
      }
    },
  },

  outbound: {
    deliveryMode: "direct",

    async sendFinal(ctx: OutboundContext, final: OutboundFinal) {
      const state = accountStates.get(ctx.accountId);
      if (!state) return;

      const channelId = parseChannelId(ctx.sessionKey);
      if (!channelId) return;

      // Slack allows 40k chars but keep chunks at 3000 for readability
      const chunks = splitMessage(final.text, 3000);
      for (const chunk of chunks) {
        await state.app.client.chat.postMessage({ channel: channelId, text: chunk });
      }
    },
  },
};

function splitMessage(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    let cut = Math.min(limit, remaining.length);
    if (remaining.length > limit) {
      const nl = remaining.lastIndexOf("\n", limit);
      if (nl > 0) cut = nl + 1;
    }
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }
  return chunks;
}
