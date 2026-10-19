import { buildSessionKey } from "@yggdrasil/config";
import { definePlugin, type ChannelPlugin, type NormalizedInboundMessage } from "@yggdrasil/sdk";

let lastMessage: NormalizedInboundMessage | null = null;

export const echoChannel: ChannelPlugin = {
  id: "echo",
  meta: { label: "Echo (test)", order: 99 },
  capabilities: { inbound: true, outbound: true },
  config: {
    listAccountIds() {
      return ["test"];
    },
    resolveAccount() {
      return {};
    },
  },
  gateway: {
    async startAccount(ctx) {
      ctx.abortSignal.addEventListener("abort", () => {});
    },
    async stopAccount() {},
  },
  outbound: {
    deliveryMode: "direct",
    async sendFinal(_ctx, final) {
      lastMessage = null;
      void final;
    },
  },
};

/** Test helper: inject an inbound message programmatically */
export async function injectEchoMessage(
  onInbound: (msg: NormalizedInboundMessage) => Promise<void>,
  body: string,
): Promise<void> {
  const message: NormalizedInboundMessage = {
    channelId: "echo",
    accountId: "test",
    sessionKey: buildSessionKey("echo", "test", "tester"),
    senderId: "tester",
    body,
  };
  lastMessage = message;
  await onInbound(message);
}

export function getLastEchoMessage(): NormalizedInboundMessage | null {
  return lastMessage;
}

const plugin = definePlugin({
  id: "echo-channel",
  name: "Echo Channel",
  version: "0.1.0",
  register(api) {
    api.registerChannel(echoChannel);
  },
});

export default plugin;
