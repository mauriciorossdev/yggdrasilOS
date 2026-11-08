import type { MessageKey } from "../i18n/index.js";
import type { WorktreeInfo } from "../repository/types.js";

/** A translatable message: render with `t(msg.key, msg.vars)`. */
export type Msg = { key: MessageKey; vars?: Record<string, string | number> };

export type WorktreeTone = "working" | "ready" | "idle" | "warn";

export type WorktreeState = { key: "active" | "dirty" | "ahead" | "clean" | "missing"; label: Msg; tone: WorktreeTone };

/** What the list shows for a worktree, from git (and Claude's lock) only — no agent link yet. */
export function worktreeState(w: WorktreeInfo): WorktreeState {
  if (w.missing) return { key: "missing", label: { key: "wt.state.missing" }, tone: "warn" };
  if (w.claudeSession?.alive) return { key: "active", label: { key: "wt.state.active" }, tone: "working" };
  if (w.changes > 0) return { key: "dirty", label: { key: "wt.state.dirty", vars: { count: w.changes } }, tone: "ready" };
  if (w.ahead > 0) return { key: "ahead", label: { key: "wt.state.ahead", vars: { count: w.ahead } }, tone: "ready" };
  return { key: "clean", label: { key: "wt.state.clean" }, tone: "idle" };
}

export const ORIGIN_LABEL: Record<WorktreeInfo["origin"], MessageKey> = {
  main: "wt.origin.main",
  app: "wt.origin.app",
  claude: "wt.origin.claude",
  manual: "wt.origin.manual",
};
