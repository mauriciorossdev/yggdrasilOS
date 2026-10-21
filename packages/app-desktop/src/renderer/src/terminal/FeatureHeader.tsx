import { requestTab } from "../chat/mainTabsBridge.js";
import { requestOpenDocument } from "../chat/documentsBridge.js";
import { ProgressBar, StatusChip } from "../ui/index.js";
import { useLatestSpecPath, useSpecSummary } from "./usePaneSpec.js";

/**
 * The feature the agents are working on: its title, status and task progress,
 * shown once above the panes (every pane handed the same doc used to repeat the
 * same chip). Click opens the doc. Renders nothing until a pane has been handed one.
 */
export function FeatureHeader() {
  const specPath = useLatestSpecPath();
  const { badge, title } = useSpecSummary(specPath);
  if (!specPath || !badge) return null;

  const counts = badge.total > 0 ? ` ${badge.done}/${badge.total}` : "";
  const progress = badge.total > 0 ? badge.done / badge.total : 0;
  return (
    <div className="feature-header">
      <button
        type="button"
        className="feature-header-title"
        title={`${specPath} — click to open`}
        onClick={() => {
          requestOpenDocument(specPath);
          requestTab("documents");
        }}
      >
        {title ?? specPath}
      </button>
      <StatusChip status={badge.status}>
        {badge.label}
        {counts}
      </StatusChip>
      {badge.total > 0 && (
        <div className="feature-header-progress">
          <ProgressBar value={progress} tone={badge.status === "ready" ? "ready" : "accent"} label="Avance de la feature" />
        </div>
      )}
    </div>
  );
}
