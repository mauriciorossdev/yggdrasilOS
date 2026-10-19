import type { YggdrasilConfig } from "@yggdrasil/config";
import type { ChatMessage } from "@yggdrasil/sdk";
import type { SessionMessage } from "./types.js";
import type { SessionStore } from "./store.js";

const DEFAULT_KEEP_RECENT = 10;

export function shouldCompact(messageCount: number, config: YggdrasilConfig): boolean {
  const threshold = config.sessions?.compactThreshold ?? 40;
  return messageCount >= threshold;
}

export function compactTruncate(messages: SessionMessage[], keep: number): SessionMessage[] {
  if (messages.length <= keep) return messages;
  return messages.slice(messages.length - keep);
}

export async function compactSummarize(
  messages: SessionMessage[],
  options: {
    keepRecent: number;
    summarize: (messages: ChatMessage[]) => Promise<string>;
  },
): Promise<SessionMessage[]> {
  const { keepRecent, summarize } = options;
  if (messages.length <= keepRecent) return messages;

  const old = messages.slice(0, messages.length - keepRecent);
  const recent = messages.slice(messages.length - keepRecent);
  const summaryText = await summarize(old.map(({ timestamp: _ts, ...rest }) => rest));

  const summaryMsg: SessionMessage = {
    role: "system",
    content: `[Resumen previo] ${summaryText}`,
    timestamp: Date.now(),
  };

  return [summaryMsg, ...recent];
}

export type MaybeCompactOptions = {
  sessionKey: string;
  store: SessionStore;
  config: YggdrasilConfig;
  summarize?: (messages: ChatMessage[]) => Promise<string>;
};

export async function maybeCompactSession(options: MaybeCompactOptions): Promise<ChatMessage[]> {
  const { sessionKey, store, config } = options;
  const record = await store.get(sessionKey);
  if (!record || !shouldCompact(record.messages.length, config)) {
    return store.getHistoryBeforeLastUser(sessionKey);
  }

  const policy = config.sessions?.compactionPolicy ?? "summarize";
  const maxMessages = config.sessions?.maxMessages ?? 50;
  const keepRecent = Math.min(DEFAULT_KEEP_RECENT, maxMessages);
  const oldCount = record.messages.length;

  let compacted: SessionMessage[];
  if (policy === "summarize" && options.summarize) {
    try {
      compacted = await compactSummarize(record.messages, {
        keepRecent,
        summarize: options.summarize,
      });
    } catch {
      compacted = compactTruncate(record.messages, keepRecent);
    }
  } else {
    compacted = compactTruncate(record.messages, keepRecent);
  }

  await store.replaceMessages(sessionKey, compacted, {
    lastCompactedAt: Date.now(),
    summarizedThroughIndex: Math.max(0, oldCount - keepRecent),
  });

  return store.getHistoryBeforeLastUser(sessionKey);
}
