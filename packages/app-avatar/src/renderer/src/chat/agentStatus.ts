import type { ChatState } from "./chatReducer.js";

export type AgentStatus =
  | { kind: "approval"; toolName: string }
  | { kind: "running"; tools: string[] }
  | { kind: "responding" }
  | { kind: "thinking" }
  | { kind: "speaking" }
  | null;

/**
 * Derived purely from existing turn/stream/tool state — there's no separate
 * "planning" signal from the gateway (a plan is just the model's own text,
 * streamed like any other reply), so "responding" covers both a narrated
 * plan and the final answer. What IS distinguishable: turn started but
 * nothing back yet (thinking), text streaming in (responding), a tool
 * actually running (running), and TTS audio actively playing (speaking,
 * passed in separately since it's local playback state, not a gateway
 * event) — that's the real granularity available.
 */
export function deriveAgentStatus(state: ChatState, isSpeaking: boolean): AgentStatus {
  if (state.pendingApproval) return { kind: "approval", toolName: state.pendingApproval.toolName };
  if (state.runningTools.length > 0) return { kind: "running", tools: state.runningTools };
  if (state.isStreaming) return { kind: "responding" };
  if (state.isTurnActive) return { kind: "thinking" };
  if (isSpeaking) return { kind: "speaking" };
  return null;
}
