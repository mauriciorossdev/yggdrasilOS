import { useState } from "react";
import type { PendingApproval } from "./chatReducer.js";
import { useI18n } from "../i18n/index.js";
import { summarizeArgs } from "./toolFormat.js";

type Props = {
  approval: PendingApproval;
  onRespond: (requestId: string, approved: boolean, trustDeviceId?: string) => void;
};

// ChatView.tsx renders this with key={approval.requestId} — that's what
// resets `trustDevice` back to unchecked for each new request instead of
// one approval's checkbox state bleeding into the next.
export function ApprovalBar({ approval, onRespond }: Props) {
  const { t } = useI18n();
  const [trustDevice, setTrustDevice] = useState(false);

  // deviceId is only ever set for a connection that isn't the desktop's own
  // loopback one (see requireFsApproval/deviceIdByConnectionId in
  // the gateway's fs-methods.ts) — i.e. exactly the case this checkbox exists for.
  // destructive calls (fs.delete, etc.) never get a trust bypass on the
  // gateway side regardless, so offering the checkbox there would lie.
  const canTrustDevice = !!approval.deviceId && approval.riskLevel !== "destructive";

  const summary = summarizeArgs(approval.args);
  const risky = approval.riskLevel === "destructive";

  return (
    <div className={`approval-bar approval-compact risk-${approval.riskLevel ?? "safe"}`}>
      <div className="approval-main">
        <span className="approval-dot" aria-hidden />
        <div className="approval-text">
          <div className="approval-title">
            <strong>{t("chat.approval.required", { tool: approval.toolName })}</strong>
            {risky && <span className="risk-tag">{approval.riskLevel}</span>}
          </div>
          {summary && <code className="approval-summary">{summary}</code>}
        </div>
        <div className="approval-actions">
          <button type="button" className="deny" onClick={() => onRespond(approval.requestId, false)}>
            {t("chat.approval.deny")}
          </button>
          <button
            type="button"
            className="approve"
            onClick={() => onRespond(approval.requestId, true, trustDevice ? approval.deviceId : undefined)}
          >
            {t("chat.approval.approve")}
          </button>
        </div>
      </div>
      <details className="approval-details">
        <summary>{t("chat.approval.details")}</summary>
        <pre>{JSON.stringify(approval.args, null, 2)}</pre>
      </details>
      {canTrustDevice && (
        <label className="approval-trust-device">
          <input type="checkbox" checked={trustDevice} onChange={(e) => setTrustDevice(e.target.checked)} />
          {t("chat.approval.trustDevice")}
        </label>
      )}
    </div>
  );
}
