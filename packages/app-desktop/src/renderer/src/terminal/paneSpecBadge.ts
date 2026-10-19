import { parseStatus, parseTasks, type FeatureStatus } from "../documents/featureDoc.js";

export type PaneSpecBadge = {
  status: FeatureStatus;
  label: string;
  done: number;
  total: number;
};

const LABEL: Record<FeatureStatus, string> = {
  working: "Working",
  checking: "Checking",
  ready: "Ready",
  "needs-decision": "Needs your decision",
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
  return { status, label: LABEL[status], done, total };
}
