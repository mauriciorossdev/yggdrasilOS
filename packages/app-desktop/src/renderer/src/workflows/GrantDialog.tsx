import { useEffect, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";
import type { Grant } from "./types.js";

type Props = {
  workflowId: string;
  onGranted: (grant: Grant) => void;
  onCancel: () => void;
};

type Preview = { graphHash: string; riskyNodes: { nodeId: string; tool: string; riskLevel: "moderate" | "destructive" }[] };

/**
 * Modal shell copied from agentFlow/UnsavedChangesModal.tsx (`.modal-overlay`
 * click-outside-cancels + `.modal` stopPropagation), content styled after
 * ApprovalBar.tsx's risk-level badge + JSON-ish preview — see
 * notes/automation/workflows-design.md §6.2/§7.1 (workflows.grant.preview/grant).
 */
export function GrantDialog({ workflowId, onGranted, onCancel }: Props) {
  const { call } = useGateway();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [granting, setGranting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    call<Preview>("workflows.grant.preview", { id: workflowId })
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [workflowId, call]);

  const grant = async () => {
    if (!preview) return;
    setGranting(true);
    setError(null);
    try {
      const result = await call<{ grant: Grant }>("workflows.grant", { id: workflowId, graphHash: preview.graphHash });
      onGranted(result.grant);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGranting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Grant this workflow</h2>
        </div>
        <p>
          This workflow has node(s) that need explicit approval before they can run — granting covers the exact
          version below. Editing any node's params later invalidates this grant.
        </p>

        {error && <p className="error">{error}</p>}
        {!preview && !error && <p className="muted">Loading…</p>}

        {preview && (
          <ul className="flow-connections-list">
            {preview.riskyNodes.map((n) => (
              <li key={n.nodeId} className={`approval-bar risk-${n.riskLevel}`}>
                <div className="approval-info">
                  <strong className="approval-warning-label">
                    {n.tool} <span className="risk-tag">{n.riskLevel}</span>
                  </strong>
                  <span className="muted">node "{n.nodeId}"</span>
                </div>
              </li>
            ))}
            {preview.riskyNodes.length === 0 && <li className="muted">No risky nodes — nothing to grant.</li>}
          </ul>
        )}

        <div className="agent-form-actions">
          <button type="button" onClick={onCancel} disabled={granting}>
            Cancel
          </button>
          <button type="button" onClick={() => void grant()} disabled={!preview || granting}>
            {granting ? "Granting…" : "Grant and run"}
          </button>
        </div>
      </div>
    </div>
  );
}
