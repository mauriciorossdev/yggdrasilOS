import type { YggdrasilConfig } from "@yggdrasil/config";
import type { ChannelPlugin, EventBus, ToolApprovalHandler } from "@yggdrasil/sdk";
import { listChannels } from "@yggdrasil/kernel";
import { ingestInboundMessage, runChannelTurn } from "@yggdrasil/pipeline";
import { createConsoleLogger } from "@yggdrasil/kernel";

export type ChannelAccountState = {
  channelId: string;
  accountId: string;
  running: boolean;
  abortController?: AbortController;
};

export type ChannelManagerOptions = {
  config: YggdrasilConfig;
  workspaceRoot?: string;
  onInbound?: (channelId: string, accountId: string, body: string) => void;
  onDelta?: (channelId: string, accountId: string, sessionKey: string, text: string) => void;
  approveTool?: ToolApprovalHandler;
  events?: EventBus;
};

export class ChannelManager {
  private readonly states = new Map<string, ChannelAccountState>();
  private readonly logger = createConsoleLogger("channel-manager");

  constructor(private options: ChannelManagerOptions) {}

  updateConfig(newConfig: YggdrasilConfig): void {
    this.options.config = newConfig;
  }

  private key(channelId: string, accountId: string): string {
    return `${channelId}:${accountId}`;
  }

  async startChannel(channelId: string, accountId = "default"): Promise<void> {
    const channel = listChannels().find((c) => c.id === channelId);
    if (!channel?.gateway?.startAccount) {
      throw new Error(`Channel "${channelId}" has no gateway adapter`);
    }

    const k = this.key(channelId, accountId);
    if (this.states.get(k)?.running) return;

    const abortController = new AbortController();
    this.states.set(k, { channelId, accountId, running: true, abortController });

    await channel.gateway.startAccount({
      accountId,
      config: this.options.config.channels?.[channelId]?.accounts?.[accountId] ?? {},
      globalConfig: this.options.config,
      abortSignal: abortController.signal,
      onInbound: async (message) => {
        this.options.onInbound?.(channelId, accountId, message.body);
        const normalized = ingestInboundMessage(message);

        await runChannelTurn({
          message: normalized,
          config: this.options.config,
          workspaceRoot: this.options.workspaceRoot,
          approveTool: this.options.approveTool,
          events: this.options.events,
          onDelta: (delta) => {
            const ch = listChannels().find((c) => c.id === channelId);
            const outboundCtx = {
              channelId,
              accountId,
              sessionKey: normalized.sessionKey,
            };
            if (ch?.outbound?.sendBlock) {
              void ch.outbound.sendBlock(outboundCtx, { text: delta, partial: true });
            }
            this.options.onDelta?.(channelId, accountId, normalized.sessionKey, delta);
          },
        });
      },
    });
  }

  async stopChannel(channelId: string, accountId = "default"): Promise<void> {
    const k = this.key(channelId, accountId);
    const state = this.states.get(k);
    if (!state) return;

    state.abortController?.abort();
    const channel = listChannels().find((c) => c.id === channelId);
    await channel?.gateway?.stopAccount?.({
      accountId,
      config: this.options.config.channels?.[channelId]?.accounts?.[accountId] ?? {},
    });
    state.running = false;
    this.states.delete(k);
  }

  async startAllEnabled(): Promise<void> {
    for (const channel of listChannels()) {
      const channelConfig = this.options.config.channels?.[channel.id];
      if (channelConfig?.enabled === false) continue;
      if (!channel.gateway?.startAccount) continue;

      const accountIds = await channel.config.listAccountIds();
      for (const accountId of accountIds) {
        try {
          await this.startChannel(channel.id, accountId);
        } catch (err) {
          this.logger.error(`Failed to start ${channel.id}/${accountId}`, {
            error: String(err),
          });
        }
      }
    }
  }

  async stopAll(): Promise<void> {
    for (const state of [...this.states.values()]) {
      await this.stopChannel(state.channelId, state.accountId);
    }
  }

  status(): Array<{ channelId: string; accountId: string; running: boolean }> {
    return [...this.states.values()].map((s) => ({
      channelId: s.channelId,
      accountId: s.accountId,
      running: s.running,
    }));
  }

  getChannelPlugin(channelId: string): ChannelPlugin | undefined {
    return listChannels().find((c) => c.id === channelId);
  }
}
