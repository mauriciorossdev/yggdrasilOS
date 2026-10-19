import type { ChatMessage } from "@yggdrasil/sdk";

export type SessionMessage = ChatMessage & {
  timestamp: number;
};

export type SessionCompactionState = {
  lastCompactedAt?: number;
  summarizedThroughIndex?: number;
};

export type SessionRecord = {
  sessionKey: string;
  title?: string;
  agentId?: string;
  messages: SessionMessage[];
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
  compaction?: SessionCompactionState;
};

export type SessionSummary = {
  sessionKey: string;
  title?: string;
  agentId?: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
  /**
   * The most recent user/assistant message, for a chat-list preview —
   * "tool" and "system" messages are skipped (a raw tool-result blob makes a
   * bad preview), and content is collapsed to a single-line, length-capped
   * string (multimodal content keeps only its text parts). Absent when the
   * session has no user/assistant message with any text yet.
   */
  lastMessage?: {
    role: "user" | "assistant";
    preview: string;
    timestamp: number;
  };
};

export type SessionPatch = {
  title?: string;
  metadata?: Record<string, unknown>;
  agentId?: string;
};
