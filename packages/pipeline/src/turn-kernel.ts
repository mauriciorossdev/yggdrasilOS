import type { AgentConfig, YggdrasilConfig } from "@yggdrasil/config";
import { resolveAgent, resolveProviderConfig } from "@yggdrasil/config";
import { resolveContext } from "@yggdrasil/context-runtime";
import type {
  ChannelPlugin,
  ChannelTurnAdmission,
  ChatMessage,
  EventBus,
  NormalizedInboundMessage,
  OutboundContext,
  OutboundFinal,
  ToolApprovalHandler,
} from "@yggdrasil/sdk";
import type { ApprovalMode } from "@yggdrasil/tools-sdk";
import { getChannel, getHarness, getProvider } from "@yggdrasil/kernel";
import { selectHarness, BUILTIN_ECHO_HARNESS_ID, createEchoHarness } from "@yggdrasil/harness-runtime";
import {
  getSessionStore,
  maybeCompactSession,
  trimHistoryToTokenBudget,
  compactSummarize,
  compactTruncate,
  type SessionStore,
  type SessionMessage,
} from "@yggdrasil/sessions";
import { OPENAI_COMPAT_PROVIDER_ID } from "@yggdrasil/provider-openai-compat";

export type ReplyDispatcherOptions = {
  config: YggdrasilConfig;
  workspaceRoot?: string;
  sessionStore?: SessionStore | null;
  onBlock?: (text: string) => void;
  approveTool?: ToolApprovalHandler;
  events?: EventBus;
  approvalMode?: ApprovalMode;
};

export type DispatchResult = {
  replyText: string;
  harnessId: string;
  sessionKey: string;
  usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number };
};

async function createSummarizeFn(
  config: YggdrasilConfig,
  agent: AgentConfig,
): Promise<((messages: ChatMessage[]) => Promise<string>) | undefined> {
  const providerId = agent.provider ?? OPENAI_COMPAT_PROVIDER_ID;
  const provider = getProvider(providerId);
  if (!provider?.chatComplete) return undefined;

  const providerCfg = resolveProviderConfig(config, providerId);
  const apiKey = await provider.resolveApiKey?.({ config: providerCfg });
  if (!apiKey && providerId === OPENAI_COMPAT_PROVIDER_ID) return undefined;

  const defaultModel =
    (providerCfg.defaultModel as string | undefined) ?? agent.model ?? "gpt-4o-mini";

  return async (messages: ChatMessage[]) => {
    const transcript = messages.map((m) => `${m.role}: ${m.content}`).join("\n");
    const result = await provider.chatComplete!(
      { config: providerCfg },
      {
        model: defaultModel,
        messages: [
          {
            role: "system",
            content:
              "Resume esta conversación en ≤200 palabras preservando hechos y decisiones.",
          },
          { role: "user", content: transcript },
        ],
      },
    );
    return result.text;
  };
}

export class ReplyDispatcher {
  private readonly sessionStore: SessionStore | null;

  constructor(private readonly options: ReplyDispatcherOptions) {
    this.sessionStore = options.sessionStore ?? getSessionStore();
  }

  async dispatchToHarness(message: NormalizedInboundMessage): Promise<DispatchResult> {
    const agent = resolveAgent(this.options.config, message.metadata?.agentId as string | undefined);
    // A per-message provider/model override (e.g. a UI model picker) takes
    // precedence over the resolved agent's own defaults, without mutating
    // the agent's stored config — same metadata-passthrough pattern agentId
    // itself already uses.
    const provider = (message.metadata?.provider as string | undefined) ?? agent.provider ?? "builtin";
    const modelId = (message.metadata?.model as string | undefined) ?? agent.model;
    const compactBeforeTurn = this.options.config.harness?.compactBeforeTurn !== false;

    if (this.sessionStore) {
      await this.sessionStore.appendUser(message.sessionKey, message.body);
    }

    let history: ChatMessage[] | undefined;
    if (this.sessionStore) {
      if (compactBeforeTurn) {
        const summarize = await createSummarizeFn(this.options.config, agent);
        history = await maybeCompactSession({
          sessionKey: message.sessionKey,
          store: this.sessionStore,
          config: this.options.config,
          summarize,
        });
      } else {
        history = await this.sessionStore.getHistoryBeforeLastUser(message.sessionKey);
      }

      const maxTokens = this.options.config.sessions?.maxTokens;
      if (history && maxTokens) {
        history = trimHistoryToTokenBudget(history, maxTokens);
      }
    }

    const pinnedHarness = agent.harness ? getHarness(agent.harness) : undefined;
    const selection = pinnedHarness
      ? { harness: pinnedHarness.harness, harnessId: agent.harness!, reason: "agent-pinned" as const, candidates: [] }
      : selectHarness({
          config: this.options.config,
          provider,
          modelId,
          runtime: "default",
        });

    const turnStarted = Date.now();
    void this.options.events?.emit("turn.start", {
      sessionKey: message.sessionKey,
      agentId: agent.id,
      harnessId: selection.harnessId,
      messagePreview: message.body.slice(0, 100),
    });

    const contextMessages: ChatMessage[] = [];

    if (agent.systemPrompt) {
      contextMessages.push({ role: "system", content: agent.systemPrompt });
    }

    // Project-wide preference (Settings), layered on top of every agent's
    // own system prompt rather than replacing it — set once, applies to
    // every agent's turns in this project.
    if (this.options.config.language) {
      contextMessages.push({
        role: "system",
        content: `Always respond in ${this.options.config.language}, regardless of what language the user writes in, unless they explicitly ask you to switch languages.`,
      });
    }

    // State the current tool-approval mode explicitly every turn, even when
    // it isn't "plan" — the mode can change between turns (the user cycles
    // it with Shift+Tab), and without a fresh, authoritative status line the
    // model tends to keep echoing whatever it said about approval/plan mode
    // in its own earlier replies (now baked into conversation history) even
    // after the mode has actually changed.
    const modeNotice: Record<ApprovalMode, string> = {
      auto: "Tool-approval mode: Auto. Safe tools run automatically; moderate or destructive tools will prompt the user for approval before running.",
      plan:
        "You are running in Plan Mode: a read-only investigation mode. Tools that only read or inspect " +
        "(list files, read files, search, browse) run normally. Any tool that would write, delete, move, " +
        "execute code/shell commands, or otherwise change state is automatically blocked before it runs — " +
        "do not attempt to call them, you will just get an error. Investigate as needed, then present the " +
        "user with a concrete plan or your findings and wait for them to exit Plan Mode before any action is taken.",
      restrict: "Tool-approval mode: Restrict. Every tool call, including ones that only read data, requires the user's explicit approval before it runs.",
      yolo: "Tool-approval mode: Yolo. Every tool call, including destructive ones, runs immediately with no approval prompt — act freely, you are not in Plan Mode and nothing is blocked.",
    };
    contextMessages.push({ role: "system", content: modeNotice[this.options.approvalMode ?? "auto"] });

    const providerIds = agent.contextProviders ?? this.options.config.context?.defaultProviders ?? [];
    if (providerIds.length > 0) {
      const tokenBudget = this.options.config.context?.tokenBudget;
      const assembled = await resolveContext(
        {
          sessionKey: message.sessionKey,
          agentId: agent.id,
          workspaceRoot: this.options.workspaceRoot ?? process.cwd(),
          config: {},
          globalConfig: this.options.config,
          metadata: message.metadata,
        },
        providerIds,
        tokenBudget,
      );
      contextMessages.push(...assembled);
    }

    if (contextMessages.length > 0) {
      if (history && history.length > 0 && history[0]!.role === "system") {
        history = [...contextMessages, ...history.slice(1)];
      } else {
        history = [...contextMessages, ...(history ?? [])];
      }
    }

    let result = await selection.harness.runAttempt({
      sessionKey: message.sessionKey,
      provider,
      modelId,
      message: message.body,
      history,
      metadata: message.metadata,
      onDelta: this.options.onBlock,
      approveTool: this.options.approveTool,
      workspaceRoot: this.options.workspaceRoot,
      events: this.options.events,
      approvalMode: this.options.approvalMode,
    });

    let harnessId = selection.harnessId;

    // An explicitly pinned harness (global harness.policy:"pinned", or an
    // agent's own `harness` field) must never get silently swapped for echo
    // — that's the entire point of pinning: deterministic, no automatic
    // harness-switching. A "fallback" classification here is always a
    // configuration problem (missing provider, missing API key — see
    // harness-llm's runAttempt, it never returns "fallback" for a transient
    // runtime error), so surfacing it as-is under the pinned harness id is
    // strictly more useful for diagnosing that than quietly answering with
    // echo, which looks like success and hides the real error.
    const isPinned = selection.reason === "pinned" || selection.reason === "agent-pinned";

    if (result.classification === "fallback" && harnessId !== BUILTIN_ECHO_HARNESS_ID && !isPinned) {
      const echo = createEchoHarness();
      result = await echo.runAttempt({
        sessionKey: message.sessionKey,
        provider,
        modelId,
        message: message.body,
        history,
        metadata: message.metadata,
      });
      harnessId = BUILTIN_ECHO_HARNESS_ID;
    }

    if (this.sessionStore) {
      if (result.sessionAppend?.length) {
        await this.sessionStore.appendMessages(message.sessionKey, result.sessionAppend);
      }
      await this.sessionStore.appendAssistant(message.sessionKey, result.text);
    }

    void this.options.events?.emit("turn.end", {
      sessionKey: message.sessionKey,
      harnessId,
      classification: result.classification,
      durationMs: Date.now() - turnStarted,
    });

    return {
      replyText: result.text,
      harnessId,
      sessionKey: message.sessionKey,
      usage: result.usage,
    };
  }

  async deliverToChannel(
    channelId: string,
    accountId: string,
    sessionKey: string,
    text: string,
  ): Promise<void> {
    const channel = getChannel(channelId);
    if (!channel?.outbound) {
      return;
    }
    const ctx: OutboundContext = { channelId, accountId, sessionKey };
    if (channel.outbound.sendFinal) {
      const final: OutboundFinal = { text };
      await channel.outbound.sendFinal(ctx, final);
    } else if (channel.outbound.sendText) {
      await channel.outbound.sendText(ctx, text);
    }
  }
}

export type CompactSessionNowOptions = {
  sessionKey: string;
  store: SessionStore;
  config: YggdrasilConfig;
  agentId?: string;
};

export type CompactSessionNowResult = {
  compacted: boolean;
  before: number;
  after: number;
};

export async function compactSessionNow(
  options: CompactSessionNowOptions,
): Promise<CompactSessionNowResult> {
  const { sessionKey, store, config, agentId } = options;
  const record = await store.get(sessionKey);
  const before = record?.messages.length ?? 0;
  if (!record || before === 0) {
    return { compacted: false, before, after: before };
  }

  const agent = resolveAgent(config, agentId);
  const summarize = await createSummarizeFn(config, agent);
  const maxMessages = config.sessions?.maxMessages ?? 50;
  const keepRecent = Math.min(10, maxMessages);
  const policy = config.sessions?.compactionPolicy ?? "summarize";

  let compacted: SessionMessage[];
  if (policy === "summarize" && summarize) {
    try {
      compacted = await compactSummarize(record.messages, { keepRecent, summarize });
    } catch {
      compacted = compactTruncate(record.messages, keepRecent);
    }
  } else {
    compacted = compactTruncate(record.messages, keepRecent);
  }

  await store.replaceMessages(sessionKey, compacted, {
    lastCompactedAt: Date.now(),
    summarizedThroughIndex: Math.max(0, before - keepRecent),
  });

  return { compacted: true, before, after: compacted.length };
}

export type RunChannelTurnParams = {
  message: NormalizedInboundMessage;
  config: YggdrasilConfig;
  workspaceRoot?: string;
  admission?: ChannelTurnAdmission;
  sessionStore?: SessionStore | null;
  onBlock?: (text: string) => void;
  onDelta?: (text: string) => void;
  approveTool?: ToolApprovalHandler;
  events?: EventBus;
  approvalMode?: ApprovalMode;
};

export type RunChannelTurnResult = {
  admission: ChannelTurnAdmission;
  replyText?: string;
  sessionKey: string;
  harnessId?: string;
  usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number };
};

function resolveAdmission(
  requested: ChannelTurnAdmission | undefined,
  message: NormalizedInboundMessage,
): ChannelTurnAdmission {
  if (requested) return requested;
  if (!message.body.trim()) return "drop";
  return "dispatch";
}

export async function runChannelTurn(params: RunChannelTurnParams): Promise<RunChannelTurnResult> {
  const admission = resolveAdmission(params.admission, params.message);

  if (admission === "drop") {
    return { admission, sessionKey: params.message.sessionKey };
  }

  if (admission === "observeOnly") {
    return { admission, sessionKey: params.message.sessionKey };
  }

  const dispatcher = new ReplyDispatcher({
    config: params.config,
    workspaceRoot: params.workspaceRoot,
    sessionStore: params.sessionStore,
    onBlock: params.onDelta ?? params.onBlock,
    approveTool: params.approveTool,
    events: params.events,
    approvalMode: params.approvalMode,
  });

  const dispatch = await dispatcher.dispatchToHarness(params.message);

  await dispatcher.deliverToChannel(
    params.message.channelId,
    params.message.accountId,
    params.message.sessionKey,
    dispatch.replyText,
  );

  return {
    admission: "dispatch",
    replyText: dispatch.replyText,
    harnessId: dispatch.harnessId,
    sessionKey: params.message.sessionKey,
    usage: dispatch.usage,
  };
}

export function ingestInboundMessage(message: NormalizedInboundMessage): NormalizedInboundMessage {
  return {
    ...message,
    timestamp: message.timestamp ?? Date.now(),
    body: message.body.trim(),
  };
}

export function getChannelForMessage(channelId: string): ChannelPlugin | undefined {
  return getChannel(channelId);
}
