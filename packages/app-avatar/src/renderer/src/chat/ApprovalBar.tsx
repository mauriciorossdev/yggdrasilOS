import type { PendingApproval } from "./chatReducer.js";

type Props = {
  approval: PendingApproval;
  onRespond: (requestId: string, approved: boolean) => void;
};

export function ApprovalBar({ approval, onRespond }: Props) {
  return (
    <div className={`approval-bar risk-${approval.riskLevel ?? "safe"}`}>
      <div className="approval-info">
        <strong>⚠ Approval required — {approval.toolName}</strong>
        {approval.riskLevel && <span className="risk-tag">{approval.riskLevel}</span>}
        <pre>{JSON.stringify(approval.args, null, 2)}</pre>
      </div>
      <div className="approval-actions">
        <button type="button" className="approve" onClick={() => onRespond(approval.requestId, true)}>
          Approve
        </button>
        <button type="button" className="deny" onClick={() => onRespond(approval.requestId, false)}>
          Deny
        </button>
      </div>
    </div>
  );
}
