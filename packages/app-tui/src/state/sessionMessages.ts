import type { ChatMessage } from "./store.js";

type StoredMessage = { role: string; content: string; timestamp?: number };

/** Maps a gateway session record's messages onto the TUI's own message list. */
export function toChatMessages(stored: StoredMessage[], idPrefix = "resumed"): ChatMessage[] {
  return stored.map((m, i) => ({
    id: `${idPrefix}-${i}`,
    role: (m.role === "user" || m.role === "assistant" || m.role === "tool" ? m.role : "system") as ChatMessage["role"],
    text: m.content,
    timestamp: m.timestamp ?? Date.now(),
  }));
}
