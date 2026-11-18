import type { AgentInfo } from "../types.js";

/**
 * Settings → Agents edits agents straight through the gateway, and Settings can be
 * opened from places that don't hold the chat's agent list (title bar, Home). The
 * chat listens here so its composer's agent picker picks up the change.
 */
export type AgentsChange =
  | { kind: "saved"; agents: AgentInfo[]; agentId: string }
  | { kind: "deleted"; agents: AgentInfo[]; agentId: string };

const listeners = new Set<(change: AgentsChange) => void>();

export function emitAgentsChanged(change: AgentsChange): void {
  listeners.forEach((fn) => fn(change));
}

/** Returns an unsubscribe. */
export function onAgentsChanged(fn: (change: AgentsChange) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
