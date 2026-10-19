import { Fragment, useEffect, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";
import type { Run } from "./types.js";

type Props = {
  workflowId: string;
  /** Bumped by the parent whenever a new run starts/finishes, to force a refetch without polling. */
  refreshToken: number;
  onCancel: (runId: string) => void;
};

const STATUS_LABEL: Record<Run["status"], string> = {
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
  skipped: "Skipped",
};

/**
 * List + expandable detail of past runs for one workflow — no existing
 * precedent in this codebase to model (see the Fase 3 research notes), so
 * this follows PairedDevicesSection.tsx's own load/list/error idiom instead
 * (own useState<T|null>, own useGateway().call cycle).
 */
export function RunHistoryPanel({ workflowId, refreshToken, onCancel }: Props) {
  const { call } = useGateway();
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedNodeKey, setExpandedNodeKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRuns(null);
    call<{ runs: Run[] }>("workflows.runs.list", { workflowId, limit: 50 })
      .then((r) => {
        if (!cancelled) setRuns(r.runs);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [workflowId, refreshToken, call]);

  return (
    <div className="agent-flow-sidebar workflow-drawer">
      <h3>Run history</h3>
      {error && <p className="error">{error}</p>}
      {runs === null && !error && <p className="muted">Loading…</p>}
      {runs?.length === 0 && <p className="muted">No runs yet.</p>}

      <ul className="flow-connections-list">
        {runs?.map((run) => (
          <li key={run.id} className="workflow-run-row">
            <div
              className="flow-connection-row"
              onClick={() => setExpandedId(expandedId === run.id ? null : run.id)}
              style={{ cursor: "pointer" }}
            >
              <span>
                <span className={`workflow-run-status workflow-run-status-${run.status}`}>{STATUS_LABEL[run.status]}</span>
                {" · "}
                {new Date(run.startedAt).toLocaleString()}
                {" · "}
                {run.trigger.type}
              </span>
              {run.status === "running" && (
                <button
                  type="button"
                  className="icon-btn"
                  title="Cancel"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCancel(run.id);
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
            {expandedId === run.id && (
              <div className="workflow-run-detail">
                {run.error && <p className="error">{run.error.message}</p>}
                <table>
                  <tbody>
                    {Object.entries(run.nodes).map(([nodeId, state]) => {
                      const nodeKey = `${run.id}:${nodeId}`;
                      const hasOutput = state.output !== undefined;
                      return (
                        <Fragment key={nodeId}>
                          <tr
                            style={{ cursor: hasOutput ? "pointer" : undefined }}
                            onClick={hasOutput ? () => setExpandedNodeKey(expandedNodeKey === nodeKey ? null : nodeKey) : undefined}
                          >
                            <td>{nodeId}</td>
                            <td>{state.status}</td>
                            <td>{state.attempts} attempt(s)</td>
                            <td>{state.error?.message ?? ""}</td>
                            <td>{hasOutput ? (expandedNodeKey === nodeKey ? "▾ output" : "▸ output") : ""}</td>
                          </tr>
                          {expandedNodeKey === nodeKey && hasOutput && (
                            <tr>
                              <td colSpan={5}>
                                <pre className="workflow-node-output">{JSON.stringify(state.output, null, 2)}</pre>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
