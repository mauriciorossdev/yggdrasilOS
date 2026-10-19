import type { ChatMessage } from "./chatReducer.js";

/**
 * Some small local models, confused by the tool-calling chat template
 * (rather than actually failing to generate anything), literally emit a
 * sentence *about* having nothing to say instead of real content — observed
 * verbatim from qwen3.5:9b via Ollama: "(the model returned an empty
 * response)", non-empty by any string check but exactly as useless as
 * genuine empty text. Treated the same as empty here. If you see a new
 * variant of this from a different model, add it to the list below rather
 * than assuming this one pattern covers everything.
 */
const JUNK_REPLY_PATTERNS = [/^\(the model returned an? empty response\)\.?$/i];

function isJunkReply(text: string): boolean {
  return JUNK_REPLY_PATTERNS.some((re) => re.test(text));
}

/**
 * Small local models frequently end a tool-calling turn with empty (or
 * junk — see isJunkReply above) text — they consider the tool call itself
 * the "answer" and never emit a closing sentence, despite the system prompt
 * asking for one. In a voice app that's a real problem: an empty/junk reply
 * means silence (or a nonsense sentence) and no real confirmation anything
 * happened. This is the application-level safety net for that — prompt
 * engineering alone can't guarantee compliance from a weaker model, so when
 * the final text is empty or junk, synthesize a minimal one from whichever
 * tools actually ran this turn (scanning `messages` backward to the last
 * user message) rather than showing/speaking something useless.
 */
export function fallbackReplyText(text: string, messages: ChatMessage[]): string {
  const trimmed = text.trim();
  if (trimmed && !isJunkReply(trimmed)) return trimmed;

  const toolNames: string[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === "user") break;
    if (m.role === "tool" && m.toolName && !toolNames.includes(m.toolName)) toolNames.unshift(m.toolName);
  }
  return toolNames.length > 0 ? `Listo — ${toolNames.join(", ")}.` : "Listo.";
}
