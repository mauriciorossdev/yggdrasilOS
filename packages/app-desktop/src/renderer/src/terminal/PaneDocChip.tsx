import { DocumentTextIcon } from "@heroicons/react/20/solid";
import { Chip, statusTone } from "../ui/index.js";
import { useI18n } from "../i18n/index.js";
import { docChipText, type PaneSpecBadge } from "./paneSpecBadge.js";

type Props = { specPath: string; badge: PaneSpecBadge; title: string | null; onOpen: () => void };

/**
 * The feature doc a pane was handed: a document icon with its task progress,
 * and its status only when that adds something to the agent's own badge
 * (checking, ready, needs a decision). Click opens the doc.
 */
export function PaneDocChip({ specPath, badge, title, onOpen }: Props) {
  const { t } = useI18n();
  const { showStatus, progress } = docChipText(badge);
  const status = t(badge.labelKey);
  const tooltip = [
    [title, status].filter(Boolean).join(" — ") +
      (badge.total > 0 ? ` · ${t("term.spec.tasks", { done: badge.done, total: badge.total })}` : ""),
    t("term.spec.openTitle", { path: specPath }),
  ].join("\n");
  return (
    <Chip
      tone={badge.status === "working" ? "neutral" : statusTone(badge.status)}
      className="pane-doc-chip"
      title={tooltip}
      onClick={onOpen}
    >
      <DocumentTextIcon className="hero-icon pane-doc-chip-icon" aria-label={status} />
      {showStatus && <span>{status}</span>}
      {progress && <span className="pane-doc-chip-progress">{progress}</span>}
    </Chip>
  );
}
