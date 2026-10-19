export type ChannelAccountContext = {
  accountId: string;
  config: unknown;
};

export type ChannelGatewayStartContext = ChannelAccountContext & {
  abortSignal: AbortSignal;
  onInbound: (message: NormalizedInboundMessage) => Promise<void>;
  globalConfig?: unknown;
};

export type ChannelGatewayStopContext = ChannelAccountContext;

export type ChannelConfigAdapter = {
  listAccountIds(): string[] | Promise<string[]>;
  resolveAccount(accountId: string): unknown | Promise<unknown>;
};

export type ChannelGatewayAdapter = {
  startAccount(ctx: ChannelGatewayStartContext): Promise<void>;
  stopAccount(ctx: ChannelGatewayStopContext): Promise<void>;
};

export type OutboundContext = {
  channelId: string;
  accountId: string;
  sessionKey: string;
};

export type OutboundBlock = {
  text: string;
  partial?: boolean;
};

export type OutboundFinal = {
  text: string;
  metadata?: Record<string, unknown>;
};

export type ChannelOutboundAdapter = {
  deliveryMode: "direct" | "gateway" | "hybrid";
  sendText?(ctx: OutboundContext, text: string): Promise<void>;
  sendBlock?(ctx: OutboundContext, block: OutboundBlock): Promise<void>;
  sendFinal?(ctx: OutboundContext, final: OutboundFinal): Promise<void>;
};

export type ChannelLifecycleAdapter = {
  onStart?(): Promise<void> | void;
  onStop?(): Promise<void> | void;
};

export type ChannelPlugin = {
  id: string;
  meta: { label: string; order?: number; description?: string };
  capabilities: {
    inbound: boolean;
    outbound: boolean;
    streaming?: boolean;
    interactive?: boolean;
  };
  config: ChannelConfigAdapter;
  gateway?: ChannelGatewayAdapter;
  outbound?: ChannelOutboundAdapter;
  lifecycle?: ChannelLifecycleAdapter;
};

export type NormalizedInboundMessage = {
  channelId: string;
  accountId: string;
  sessionKey: string;
  senderId: string;
  body: string;
  media?: Array<{ type: string; url?: string; mimeType?: string }>;
  metadata?: Record<string, unknown>;
  timestamp?: number;
};

export type ChannelTurnAdmission = "dispatch" | "observeOnly" | "drop";

export type ChannelTurnResult = {
  admission: ChannelTurnAdmission;
  replyText?: string;
  sessionKey: string;
  metadata?: Record<string, unknown>;
};
