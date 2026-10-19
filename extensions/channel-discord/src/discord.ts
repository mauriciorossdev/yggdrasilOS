import {
  Client,
  GatewayIntentBits,
  type TextChannel,
  type Message,
} from "discord.js";
import { buildSessionKey } from "@yggdrasil/config";
import type {
  ChannelPlugin,
  NormalizedInboundMessage,
  OutboundContext,
  OutboundFinal,
} from "@yggdrasil/sdk";

type DiscordAccountConfig = {
  botToken?: string;
  allowedChannelIds?: string[];
  prefix?: string;
};

type AccountState = {
  client: Client;
};

const accountStates = new Map<string, AccountState>();

function resolveToken(cfg: DiscordAccountConfig, accountId: string): string {
  const token = cfg.botToken?.trim() || process.env.DISCORD_BOT_TOKEN?.trim();
  if (!token) {
    throw new Error(
      `Discord botToken required (config or DISCORD_BOT_TOKEN) for account ${accountId}`,
    );
  }
  return token;
}

export function parseChannelId(sessionKey: string): string | undefined {
  const parts = sessionKey.split(":");
  if (parts.length < 3 || parts[0] !== "discord") return undefined;
  return parts.slice(2).join(":");
}

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

export const discordChannel: ChannelPlugin = {
  id: "discord",
  meta: { label: "Discord", order: 20, description: "Discord bot channel" },
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
      const discordCfg = channelsCfg?.discord as Record<string, unknown> | undefined;
      const accounts = discordCfg?.accounts as
        | Record<string, DiscordAccountConfig>
        | undefined;
      const accountCfg: DiscordAccountConfig = accounts?.[ctx.accountId] ?? {};

      const token = resolveToken(accountCfg, ctx.accountId);
      const allowedChannelIds = accountCfg.allowedChannelIds ?? [];
      const prefix = accountCfg.prefix ?? "";

      const client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
        ],
      });

      client.on("messageCreate", (msg: Message) => {
        if (msg.author.bot) return;

        const channelId = msg.channelId;
        if (allowedChannelIds.length > 0 && !allowedChannelIds.includes(channelId)) return;

        let body = msg.content;
        if (prefix) {
          if (!body.startsWith(prefix)) return;
          body = body.slice(prefix.length).trim();
        }
        if (!body) return;

        const sessionKey = buildSessionKey("discord", ctx.accountId, channelId);
        const inbound: NormalizedInboundMessage = {
          channelId: "discord",
          accountId: ctx.accountId,
          sessionKey,
          senderId: msg.author.id,
          body,
          timestamp: msg.createdTimestamp,
        };

        ctx.onInbound(inbound).catch((err: unknown) => {
          console.error("[channel-discord] onInbound error:", err);
        });
      });

      ctx.abortSignal.addEventListener("abort", () => {
        client.destroy();
        accountStates.delete(ctx.accountId);
      });

      await client.login(token);
      accountStates.set(ctx.accountId, { client });
    },

    async stopAccount(ctx) {
      const state = accountStates.get(ctx.accountId);
      if (state) {
        state.client.destroy();
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

      const channel = state.client.channels.cache.get(channelId) as
        | TextChannel
        | undefined;
      if (!channel?.send) return;

      const chunks = splitMessage(final.text, 2000);
      for (const chunk of chunks) {
        await channel.send(chunk);
      }
    },
  },
};
