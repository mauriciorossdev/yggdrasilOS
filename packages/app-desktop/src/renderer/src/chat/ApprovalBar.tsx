import { useState } from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/20/solid";
import type { PendingApproval } from "./chatReducer.js";

type Props = {
  approval: PendingApproval;
  onRespond: (requestId: string, approved: boolean, trustDeviceId?: string) => void;
};

// ChatView.tsx renders this with key={approval.requestId} — that's what
// resets `trustDevice` back to unchecked for each new request instead of
// one approval's checkbox state bleeding into the next.
export function ApprovalBar({ approval, onRespond }: Props) {
  const [trustDevice, setTrustDevice] = useState(false);

  // deviceId is only ever set for a connection that isn't the desktop's own
  // loopback one (see requireFsApproval/deviceIdByConnectionId in
  // gateway/methods.ts) — i.e. exactly the case this checkbox exists for.
  // destructive calls (fs.delete, etc.) never get a trust bypass on the
  // gateway side regardless, so offering the checkbox there would lie.
  const canTrustDevice = !!approval.deviceId && approval.riskLevel !== "destructive";

  return (
    <div className={`approval-bar risk-${approval.riskLevel ?? "safe"}`}>
      <div className="approval-info">
        <strong className="approval-warning-label">
          <ExclamationTriangleIcon className="hero-icon" /> Approval required — {approval.toolName}
        </strong>
        {approval.riskLevel && <span className="risk-tag">{approval.riskLevel}</span>}
        <pre>{JSON.stringify(approval.args, null, 2)}</pre>
        {canTrustDevice && (
          <label className="approval-trust-device">
            <input type="checkbox" checked={trustDevice} onChange={(e) => setTrustDevice(e.target.checked)} />
            Confiar en este dispositivo (no volver a preguntar)
          </label>
        )}
      </div>
      <div className="approval-actions">
        <button
          type="button"
          className="approve"
          onClick={() => onRespond(approval.requestId, true, trustDevice ? approval.deviceId : undefined)}
        >
          Approve
        </button>
        <button type="button" className="deny" onClick={() => onRespond(approval.requestId, false)}>
          Deny
        </button>
      </div>
    </div>
  );
}
