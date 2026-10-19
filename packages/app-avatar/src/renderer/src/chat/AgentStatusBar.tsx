import type { AgentStatus } from "./agentStatus.js";

const LABELS: Record<Exclude<AgentStatus, null>["kind"], string> = {
  thinking: "Thinking…",
  responding: "Responding…",
  running: "Running",
  approval: "Waiting for approval",
  speaking: "Speaking…",
};

export function AgentStatusBar({ status }: { status: AgentStatus }) {
  if (!status) return null;

  const detail = status.kind === "running" ? status.tools.join(", ") : status.kind === "approval" ? status.toolName : null;

  return (
    <div className={`agent-status agent-status-${status.kind}`}>
      <span className="spinner" />
      <span>{LABELS[status.kind]}</span>
      {detail && <span className="agent-status-detail">{detail}</span>}
    </div>
  );
}
