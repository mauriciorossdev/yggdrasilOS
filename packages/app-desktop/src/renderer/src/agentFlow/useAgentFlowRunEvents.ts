import { useEffect, useRef, useState } from "react";
import type { GatewayWsEvent } from "@yggdrasil/client-web";
import type { TurnEndPayload, TurnStartPayload } from "../types.js";

export type AgentFlowDelegateStartPayload = {
  parentSessionKey: string;
  agentId: string;
  subSessionKey: string;
};

export type AgentFlowRunState = {
  runningNodeIds: Set<string>;
  /** Learned live from agentflow.delegate.start — used to join a delegated node's terminal pane to its real sub-session (see AgentFlowView/TerminalPane). */
  subSessionKeyByAgentId: Map<string, string>;
};

/**
 * Tracks which Agent Flow nodes are actively mid-turn during a "Run Flow"
 * run, purely from gateway events — same subscription mechanism
 * chat/useChatEvents.ts already uses for the Chat tab. turn.start already
 * carries the agentId handling that turn (turn-kernel.ts), so there's no
 * need to parse it back out of the "::sub:" sessionKey convention — we just
 * remember which sessionKey belongs to which node while it's running.
 */
export function useAgentFlowRunEvents(
  onEvent: (handler: (ev: GatewayWsEvent) => void) => () => void,
  rootSessionKey: string | null,
  nodeIdByAgentId: Map<string, string>,
): AgentFlowRunState {
  const [runningNodeIds, setRunningNodeIds] = useState<Set<string>>(new Set());
  const [subSessionKeyByAgentId, setSubSessionKeyByAgentId] = useState<Map<string, string>>(new Map());
  const nodeIdBySessionKeyRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    // A fresh run: forget whatever the previous run was tracking.
    setRunningNodeIds(new Set());
    setSubSessionKeyByAgentId(new Map());
    nodeIdBySessionKeyRef.current = new Map();

    if (!rootSessionKey) return;

    const belongsToThisRun = (sessionKey: string | undefined) =>
      !!sessionKey && (sessionKey === rootSessionKey || sessionKey.startsWith(`${rootSessionKey}::sub:`));

    return onEvent((ev) => {
      switch (ev.event) {
        case "turn.start": {
          const p = ev.payload as TurnStartPayload;
          if (!belongsToThisRun(p.sessionKey)) return;
          const nodeId = nodeIdByAgentId.get(p.agentId);
          if (!nodeId) return;
          nodeIdBySessionKeyRef.current.set(p.sessionKey, nodeId);
          setRunningNodeIds((prev) => new Set(prev).add(nodeId));
          break;
        }
        case "turn.end": {
          const p = ev.payload as TurnEndPayload;
          if (!belongsToThisRun(p.sessionKey)) return;
          const nodeId = nodeIdBySessionKeyRef.current.get(p.sessionKey);
          nodeIdBySessionKeyRef.current.delete(p.sessionKey);
          if (!nodeId) return;
          setRunningNodeIds((prev) => {
            const next = new Set(prev);
            next.delete(nodeId);
            return next;
          });
          break;
        }
        case "agentflow.delegate.start": {
          const p = ev.payload as AgentFlowDelegateStartPayload;
          if (!belongsToThisRun(p.parentSessionKey)) return;
          setSubSessionKeyByAgentId((prev) => new Map(prev).set(p.agentId, p.subSessionKey));
          break;
        }
        default:
          break;
      }
    });
  }, [onEvent, rootSessionKey, nodeIdByAgentId]);

  return { runningNodeIds, subSessionKeyByAgentId };
}
