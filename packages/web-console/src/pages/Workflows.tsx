import { useCallback, useEffect, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";
import { Chip } from "@yggdrasil/ui-kit";
import { useT } from "../i18n";

type Workflow = { id: string; name: string; enabled: boolean; triggers: Array<{ type: string }> };
type Summary = { workflow: Workflow; grantStatus: "not_required" | "none" | "granted" | "stale" };
type Run = { id: string; workflowId: string; status: "running" | "succeeded" | "failed" | "cancelled" | "skipped"; startedAt: string; endedAt?: string; error?: { message: string }; trigger: { type: string } };

const RUN_TONE = { running: "working", succeeded: "ready", failed: "danger", cancelled: "neutral", skipped: "neutral" } as const;

/**
 * Workflows: turn on/off, run now, cancel, and recent runs. Editing the graph and granting
 * risky steps stay in the desktop app (the grant is the desktop's).
 */
export function WorkflowsPage() {
  const { call, onEvent, connected } = useGateway();
  const t = useT();
  const [workflows, setWorkflows] = useState<Summary[] | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [w, r] = await Promise.all([
        call<{ workflows: Summary[] }>("workflows.list"),
        call<{ runs: Run[] }>("workflows.runs.list", { limit: 30 }),
      ]);
      setWorkflows(w.workflows);
      setRuns(r.runs);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setWorkflows([]);
    }
  }, [call]);

  useEffect(() => {
    if (connected) void refresh();
  }, [connected, refresh]);

  // Runs started anywhere (app, phone, schedule) show up live.
  useEffect(
    () =>
      onEvent((ev) => {
        if (ev.event === "workflow.run.started" || ev.event === "workflow.run.finished") void refresh();
      }),
    [onEvent, refresh],
  );

  const act = async (fn: () => Promise<unknown>) => {
    try {
      const res = (await fn()) as { skipped?: boolean; reason?: string } | undefined;
      if (res?.skipped) setError(t("wf.skipped", { reason: res.reason ?? "" }));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const nameOf = (id: string) => workflows?.find((w) => w.workflow.id === id)?.workflow.name ?? id;

  return (
    <div className="page">
      <h1>{t("nav.workflows")}</h1>
      {error && <p className="error">{error}</p>}
      {workflows === null ? (
        <p className="muted">{t("common.loading")}</p>
      ) : workflows.length === 0 ? (
        <p className="muted">{t("wf.empty")}</p>
      ) : (
        <ul className="card-list">
          {workflows.map(({ workflow: w, grantStatus }) => {
            const needsGrant = grantStatus === "none" || grantStatus === "stale";
            return (
              <li key={w.id} className="card row wf-row">
                <div className="grow">
                  <strong>{w.name}</strong>
                  <div className="muted">
                    {w.triggers.map((tr) => tr.type).join(", ") || t("wf.manualOnly")}
                    {needsGrant && <> · {t("wf.needsGrant")}</>}
                  </div>
                </div>
                <label className="checkbox-row">
                  <input type="checkbox" checked={w.enabled} onChange={(e) => void act(() => call("workflows.setEnabled", { id: w.id, enabled: e.target.checked }))} />
                  {t("wf.enabled")}
                </label>
                <button type="button" disabled={needsGrant} onClick={() => void act(() => call("workflows.run", { id: w.id }))}>
                  {t("wf.run")}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <h2>{t("wf.runs")}</h2>
      {runs.length === 0 ? (
        <p className="muted">{t("wf.noRuns")}</p>
      ) : (
        <div className="card">
        <ul className="status-list">
          {runs.map((r) => (
            <li key={r.id} title={r.error?.message}>
              <span>
                {nameOf(r.workflowId)} <span className="muted">· {r.trigger.type} · {new Date(r.startedAt).toLocaleString()}</span>
              </span>
              <span className="row">
                <Chip tone={RUN_TONE[r.status]}>{t(`wf.status.${r.status}`)}</Chip>
                {r.status === "running" && (
                  <button type="button" className="secondary" onClick={() => void act(() => call("workflows.cancel", { runId: r.id }))}>
                    {t("common.cancel")}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
        </div>
      )}
    </div>
  );
}
