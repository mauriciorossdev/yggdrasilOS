/** Events the gateway pushes during a turn, as the eval records them. */
export type RecordedEvent = { t: number; event: string; payload: Record<string, unknown> };

export type ToolCall = {
  t: number;
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  result?: string;
  error?: string;
};

export type ApprovalRecord = {
  t: number;
  toolName: string;
  args: Record<string, unknown>;
  riskLevel?: string;
  approved: boolean;
  reason: string;
};

export type TurnOutcome = {
  prompt: string;
  reply: string;
  durationMs: number;
  /** The turn was cancelled by the runner (time or tool budget), not finished by the model. */
  cancelled: "timeout" | "tool-budget" | "loop" | null;
  usage?: { inputTokens?: number; outputTokens?: number };
  error?: string;
};

export type CheckResult = { pass: boolean; detail?: string };

export type CheckContext = {
  /** The scenario's workspace (also the process cwd while the scenario runs). */
  workspace: string;
  /** Directory next to the workspace, for scenarios that plant something "outside". */
  sandboxRoot: string;
  turns: TurnOutcome[];
  toolCalls: ToolCall[];
  approvals: ApprovalRecord[];
  /** Everything the model said, joined. */
  replies: string;
};

export type Check = {
  id: string;
  description: string;
  /** A failed `must` check fails the scenario; the rest only lower the score. */
  must?: boolean;
  weight?: number;
  run: (ctx: CheckContext) => Promise<CheckResult> | CheckResult;
};

export type Scenario = {
  id: string;
  title: string;
  /** 0 = smoke, 1 = single skill, 2 = multi-step, 3 = project-sized. */
  level: 0 | 1 | 2 | 3;
  tags: string[];
  /** A restraint scenario: leaving everything alone legitimately passes, so the "doing nothing fails" grader test skips it. */
  passesWhenIdle?: boolean;
  /** One user message per turn, sent in order in the same session. */
  turns: string[];
  setup?: (ctx: { workspace: string; sandboxRoot: string }) => Promise<void>;
  checks: Check[];
  budget?: {
    /** Per turn. */
    timeoutMs?: number;
    /** Across the whole scenario; the runner cancels the turn that crosses it. */
    maxToolCalls?: number;
  };
};
