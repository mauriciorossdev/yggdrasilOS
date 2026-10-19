import { buildSessionKey } from "@yggdrasil/config";
import { defineChannelEntry, definePlugin } from "@yggdrasil/sdk";
import type { ChannelPlugin } from "@yggdrasil/sdk";

/**
 * Channel plugin template.
 *
 * Patterns:
 * - Long-polling / webhook: implement gateway.startAccount + abortSignal
 * - Outbound: sendFinal (required) and sendBlock (optional, for streaming)
 * - sessionKey: buildSessionKey(channelId, accountId, senderId)
 *
 * See extensions/channel-telegram for a full long-polling example.
 */
const channel: ChannelPlugin = defineChannelEntry({
  id: "{{PLUGIN_ID}}",
  meta: { label: "{{PLUGIN_LABEL}}", description: "Example channel plugin" },
  capabilities: { inbound: true, outbound: true, streaming: false },
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
      ctx.abortSignal.addEventListener("abort", () => {
        // stop polling / close HTTP server
      });
      // Long-poll or webhook: await ctx.onInbound({ channelId, accountId, sessionKey, senderId, body })
    },
    async stopAccount(ctx) {
      void ctx;
    },
  },
  outbound: {
    deliveryMode: "direct",
    async sendBlock(ctx, block) {
      console.log(`[{{PLUGIN_ID}}] block ${ctx.sessionKey}: ${block.text}`);
    },
    async sendFinal(ctx, final) {
      console.log(`[{{PLUGIN_ID}}] ${ctx.sessionKey}: ${final.text}`);
    },
  },
});

const plugin = definePlugin({
  id: "{{PLUGIN_ID}}",
  name: "{{PLUGIN_LABEL}}",
  version: "0.1.0",
  register(api) {
    api.registerChannel(channel);
    api.logger.info("registered channel", {
      sessionKey: buildSessionKey("{{PLUGIN_ID}}", "default", "user"),
    });
  },
});

export default plugin;
