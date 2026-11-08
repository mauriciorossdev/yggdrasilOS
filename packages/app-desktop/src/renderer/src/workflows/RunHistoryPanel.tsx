import { Fragment, useEffect, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";
import { useI18n, type MessageKey } from "../i18n/index.js";
import type { Run } from "./types.js";

type Props = {
  workflowId: string;
  /** Bumped by the parent whenever a new run starts/finishes, to force a refetch without polling. */
  refreshToken: number;
  onCancel: (runId: string) => void;
};

const STATUS_LABEL: Record<Run["status"], MessageKey> = {
  running: "wf.runs.status.running",
  succeeded: "wf.runs.status.succeeded",
  failed: "wf.runs.status.failed",
  cancelled: "wf.runs.status.cancelled",
  skipped: "wf.runs.status.skipped",
};

const NODE_STATUS_LABEL: Record<string, MessageKey> = {
  pending: "wf.runs.nodeStatus.pending",
  running: "wf.runs.nodeStatus.running",
  succeeded: "wf.runs.nodeStatus.succeeded",
  failed: "wf.runs.nodeStatus.failed",
  skipped: "wf.runs.nodeStatus.skipped",
};

const TRIGGER_TYPE_LABEL: Record<string, MessageKey> = {
  manual: "wf.triggers.type.manual",
  schedule: "wf.triggers.type.schedule",
  event: "wf.triggers.type.event",
  webhook: "wf.triggers.type.webhook",
  mobile: "wf.triggers.type.mobile",
};

/**
 * List + expandable detail of past runs for one workflow — no existing
 * precedent in this codebase to model (see the Fase 3 research notes), so
 * this follows PairedDevicesSection.tsx's own load/list/error idiom instead
 * (own useState<T|null>, own useGateway().call cycle).
 */
export function RunHistoryPanel({ workflowId, refreshToken, onCancel }: Props) {
  const { call } = useGateway();
  const { t } = useI18n();
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
      <h3>{t("wf.runs.title")}</h3>
      {error && <p className="error">{error}</p>}
      {runs === null && !error && <p className="muted">{t("wf.common.loading")}</p>}
      {runs?.length === 0 && <p className="muted">{t("wf.runs.empty")}</p>}

      <ul className="flow-connections-list">
        {runs?.map((run) => (
          <li key={run.id} className="workflow-run-row">
            <div
              className="flow-connection-row"
              onClick={() => setExpandedId(expandedId === run.id ? null : run.id)}
              style={{ cursor: "pointer" }}
            >
              <span>
                <span className={`workflow-run-status workflow-run-status-${run.status}`}>{t(STATUS_LABEL[run.status])}</span>
                {" · "}
                {new Date(run.startedAt).toLocaleString()}
                {" · "}
                {TRIGGER_TYPE_LABEL[run.trigger.type] ? t(TRIGGER_TYPE_LABEL[run.trigger.type]) : run.trigger.type}
              </span>
              {run.status === "running" && (
                <button
                  type="button"
                  className="icon-btn"
                  title={t("wf.runs.cancel")}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCancel(run.id);
                  }}
                >
                  {t("wf.runs.cancel")}
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
                            <td>{NODE_STATUS_LABEL[state.status] ? t(NODE_STATUS_LABEL[state.status]) : state.status}</td>
                            <td>{t(state.attempts === 1 ? "wf.runs.attemptsOne" : "wf.runs.attemptsMany", { count: state.attempts })}</td>
                            <td>{state.error?.message ?? ""}</td>
                            <td>{hasOutput ? `${expandedNodeKey === nodeKey ? "▾" : "▸"} ${t("wf.runs.output")}` : ""}</td>
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
