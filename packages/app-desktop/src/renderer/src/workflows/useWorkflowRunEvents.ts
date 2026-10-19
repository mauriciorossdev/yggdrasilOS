import { useEffect, useState } from "react";
import type { GatewayWsEvent } from "@yggdrasil/client-web";

type RunStartedPayload = { runId: string; workflowId: string };
type NodeStartedPayload = { runId: string; workflowId: string; nodeId: string; attempt: number };
type NodeFinishedPayload = { runId: string; workflowId: string; nodeId: string; status: "succeeded" | "failed" | "skipped"; handle?: string };
type RunFinishedPayload = { runId: string; workflowId: string; status: string };

export type WorkflowRunState = {
  liveRunId: string | null;
  runningNodeIds: Set<string>;
  nodeStatus: Record<string, "succeeded" | "failed" | "skipped">;
  /** Bumped on every run.finished for this workflow — RunHistoryPanel uses it to know when to refetch without polling. */
  historyRefreshToken: number;
};

/**
 * Live per-node run state purely from gateway events — same subscription
 * mechanism as agentFlow/useAgentFlowRunEvents.ts, scoped by workflowId
 * instead of a sessionKey since workflow runs have no session concept.
 */
export function useWorkflowRunEvents(onEvent: (handler: (ev: GatewayWsEvent) => void) => () => void, workflowId: string | null): WorkflowRunState {
  const [liveRunId, setLiveRunId] = useState<string | null>(null);
  const [runningNodeIds, setRunningNodeIds] = useState<Set<string>>(new Set());
  const [nodeStatus, setNodeStatus] = useState<Record<string, "succeeded" | "failed" | "skipped">>({});
  const [historyRefreshToken, setHistoryRefreshToken] = useState(0);

  useEffect(() => {
    setLiveRunId(null);
    setRunningNodeIds(new Set());
    setNodeStatus({});
    if (!workflowId) return;

    return onEvent((ev) => {
      switch (ev.event) {
        case "workflow.run.started": {
          const p = ev.payload as RunStartedPayload;
          if (p.workflowId !== workflowId) return;
          setLiveRunId(p.runId);
          setRunningNodeIds(new Set());
          setNodeStatus({});
          break;
        }
        case "workflow.node.started": {
          const p = ev.payload as NodeStartedPayload;
          if (p.workflowId !== workflowId) return;
          setRunningNodeIds((prev) => new Set(prev).add(p.nodeId));
          break;
        }
        case "workflow.node.finished": {
          const p = ev.payload as NodeFinishedPayload;
          if (p.workflowId !== workflowId) return;
          setRunningNodeIds((prev) => {
            const next = new Set(prev);
            next.delete(p.nodeId);
            return next;
          });
          setNodeStatus((prev) => ({ ...prev, [p.nodeId]: p.status }));
          break;
        }
        case "workflow.run.finished": {
          const p = ev.payload as RunFinishedPayload;
          if (p.workflowId !== workflowId) return;
          setLiveRunId(null);
          setRunningNodeIds(new Set());
          setHistoryRefreshToken((t) => t + 1);
          break;
        }
        default:
          break;
      }
    });
  }, [onEvent, workflowId]);

  return { liveRunId, runningNodeIds, nodeStatus, historyRefreshToken };
}
