import { useEffect, useMemo, useRef, useState } from "react";
import type { LeafPane } from "./paneTree.js";

export type TerminalCanvasEdge = { id: string; from: string; to: string };

const PULSE_DURATION_MS = 1500;

/**
 * Visualization-only edge tracking for TerminalCanvasView, driven by the
 * same `write_pane`/`create_pane` "who wrote to whom" signal already wired
 * for the Agent Flow canvas (paneControlServer.ts emits
 * "agentFlow:communication" whenever a pane call carries a `sourcePaneId`;
 * see AgentFlowView.tsx's own `onCommunication` handler for the sibling
 * consumer of this exact same IPC channel). Deliberately independent of
 * Agent Flow's own saved-flow node/edge state — this is an ephemeral,
 * session-only graph of the currently-open terminal panes, never persisted.
 *
 * Deliberately does NOT consume `onAutoCapture` — every canvas node here
 * already corresponds 1:1 to an open LeafPane (TerminalCanvasView builds
 * nodes straight from `leaves`), so there's no separate "discover a new
 * node" step the way Agent Flow needs one for spawned-but-not-yet-tracked
 * agents.
 */
export function useTerminalCanvasEdges(leaves: LeafPane[]): {
  edges: TerminalCanvasEdge[];
  activeEdgeIds: Set<string>;
} {
  const [edges, setEdges] = useState<TerminalCanvasEdge[]>([]);
  const [activeEdgeIds, setActiveEdgeIds] = useState<Set<string>>(new Set());
  const pendingTimersRef = useRef(new Set<ReturnType<typeof setTimeout>>());
  const leavesRef = useRef(leaves);
  leavesRef.current = leaves;

  // flowNodeId -> leafId, for the subset of open leaves that carry one
  // (Agent-Flow/Team-sourced panes). A plain terminal pane has no
  // flowNodeId, so its payload id already equals its raw leaf id directly —
  // getFlowNodeId (main/terminals.ts) falls back to the raw live pane id
  // when it has no mapping, and a plain pane's live id is its leaf id.
  const nodeIdToLeafId = useMemo(() => {
    const map = new Map<string, string>();
    for (const leaf of leaves) if (leaf.flowNodeId) map.set(leaf.flowNodeId, leaf.id);
    return map;
  }, [leaves]);

  useEffect(() => {
    return window.yggdrasil.agentFlow.onCommunication(({ from: rawFrom, to: rawTo }) => {
      const from = nodeIdToLeafId.get(rawFrom) ?? rawFrom;
      const to = nodeIdToLeafId.get(rawTo) ?? rawTo;
      // Skip pulses where neither side is an open canvas node — e.g. a
      // write_pane between two panes in a different project window, or a
      // since-closed pane's trailing event.
      const current = leavesRef.current;
      if (!current.some((l) => l.id === from) || !current.some((l) => l.id === to)) return;

      let pulseEdgeId = "";
      setEdges((prev) => {
        const existing = prev.find((e) => (e.from === from && e.to === to) || (e.from === to && e.to === from));
        if (existing) {
          pulseEdgeId = existing.id;
          return prev;
        }
        const created: TerminalCanvasEdge = { id: crypto.randomUUID(), from, to };
        pulseEdgeId = created.id;
        return [...prev, created];
      });

      setActiveEdgeIds((prev) => new Set(prev).add(pulseEdgeId));
      const timer = setTimeout(() => {
        pendingTimersRef.current.delete(timer);
        setActiveEdgeIds((prev) => {
          if (!prev.has(pulseEdgeId)) return prev;
          const next = new Set(prev);
          next.delete(pulseEdgeId);
          return next;
        });
      }, PULSE_DURATION_MS);
      pendingTimersRef.current.add(timer);
    });
  }, [nodeIdToLeafId]);

  useEffect(() => {
    return () => {
      for (const timer of pendingTimersRef.current) clearTimeout(timer);
      pendingTimersRef.current.clear();
    };
  }, []);

  // Drop edges referencing a leaf that's since closed — local ephemeral
  // state only, nothing to persist/clean up server-side.
  useEffect(() => {
    setEdges((prev) => {
      const liveIds = new Set(leaves.map((l) => l.id));
      const next = prev.filter((e) => liveIds.has(e.from) && liveIds.has(e.to));
      return next.length === prev.length ? prev : next;
    });
  }, [leaves]);

  return { edges, activeEdgeIds };
}
