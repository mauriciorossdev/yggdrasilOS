import type { ChatMessage } from "@yggdrasil/sdk";

const ROLE_OVERHEAD = 4;
const TOOL_CALL_OVERHEAD = 20;

export function estimateMessageTokens(msg: ChatMessage): number {
  let tokens = Math.ceil((msg.content?.length ?? 0) / 4);
  if (msg.tool_calls?.length) {
    for (const call of msg.tool_calls) {
      tokens += TOOL_CALL_OVERHEAD + Math.ceil((call.arguments?.length ?? 0) / 4);
      tokens += Math.ceil(call.name.length / 4);
    }
  }
  if (msg.tool_call_id) {
    tokens += TOOL_CALL_OVERHEAD;
  }
  if (msg.name) {
    tokens += Math.ceil(msg.name.length / 4);
  }
  return tokens + ROLE_OVERHEAD;
}

export function estimateHistoryTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

export function trimHistoryToTokenBudget(messages: ChatMessage[], maxTokens: number): ChatMessage[] {
  if (messages.length === 0 || estimateHistoryTokens(messages) <= maxTokens) {
    return messages;
  }

  const kept: ChatMessage[] = [];
  let total = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    const cost = estimateMessageTokens(msg);
    if (total + cost > maxTokens && kept.length > 0) break;
    total += cost;
    kept.unshift(msg);
  }

  return kept;
}
