import type { MessageKey } from "../i18n/index.js";
import { parseStatus, parseTasks, type FeatureStatus } from "../documents/featureDoc.js";

export type PaneSpecBadge = {
  status: FeatureStatus;
  labelKey: MessageKey;
  done: number;
  total: number;
};

const LABEL: Record<FeatureStatus, MessageKey> = {
  working: "term.spec.working",
  checking: "term.spec.checking",
  ready: "term.spec.ready",
  "needs-decision": "term.spec.needsDecision",
};

/**
 * The status chip for a pane that was handed a feature doc. An explicit
 * `Status:` line in the doc wins; without one it is derived from the task
 * list (every task ticked -> Ready, otherwise Working) so a doc nobody
 * bothered to label still reads sensibly.
 */
export function derivePaneSpecBadge(md: string): PaneSpecBadge {
  const { done, total } = parseTasks(md);
  const explicit = parseStatus(md);
  const status: FeatureStatus = explicit ?? (total > 0 && done === total ? "ready" : "working");
  return { status, labelKey: LABEL[status], done, total };
}

/**
 * What the pane's doc chip says. The agent's own badge already shows that it
 * is working, so a doc still "working" shows only its task progress; any
 * other status (checking, ready, needs a decision) is named. A decision
 * leaves the count out to stay short.
 */
export function docChipText(badge: PaneSpecBadge): { showStatus: boolean; progress: string | null } {
  const showStatus = badge.status !== "working";
  const progress = badge.total > 0 && badge.status !== "needs-decision" ? `${badge.done}/${badge.total}` : null;
  return { showStatus, progress };
}
