import { join } from "node:path";
import { computeMetrics, extractToolCalls } from "./metrics.js";
import { createAgenticPlatform, type EvalSettings } from "./platform.js";
import { writeTranscript, type RunResult } from "./report.js";
import { AgentSession } from "./session.js";
import type { CheckContext, Scenario } from "./types.js";

export type RunOptions = {
  settings: EvalSettings;
  run: number;
  outDir: string;
};

export const DEFAULT_TURN_TIMEOUT_MS = 300_000;
export const DEFAULT_MAX_TOOL_CALLS = 40;

/** Everything one scenario run needs and nothing it leaves behind: fresh gateway, fresh temp workspace. */
export async function runScenario(scenario: Scenario, options: RunOptions): Promise<RunResult> {
  const { settings, run, outDir } = options;
  // Each run gets its own fault sequence (same seed + same scenario + same run number = same faults), instead of
  // every run failing at the same first request.
  const faultSeed = (settings.faultSeed ?? 1) + run * 7919 + [...scenario.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const platform = await createAgenticPlatform({ ...settings, faultSeed });
  const sessionKey = `tui:default:eval-${scenario.id}-${run}`;
  let session: AgentSession | null = null;
  let error: string | undefined;

  try {
    await scenario.setup?.({ workspace: platform.workspace, sandboxRoot: platform.sandboxRoot });
    session = new AgentSession({
      url: platform.url,
      workspace: platform.workspace,
      sessionKey,
      approvalMode: settings.approvalMode,
      turnTimeoutMs: scenario.budget?.timeoutMs ?? DEFAULT_TURN_TIMEOUT_MS,
      maxToolCalls: scenario.budget?.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS,
      driver: settings.driver,
    });
    await session.start();
    for (const prompt of scenario.turns) {
      const outcome = await session.send(prompt);
      if (outcome.error) {
        error = outcome.error;
        break;
      }
      // A turn that had to be cut leaves the conversation in a bad place; later turns would only measure that.
      if (outcome.cancelled) break;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const events = session?.events ?? [];
  const turns = session?.turns ?? [];
  const approvals = session?.approvals ?? [];
  const toolCalls = extractToolCalls(events);
  const ctx: CheckContext = {
    workspace: platform.workspace,
    sandboxRoot: platform.sandboxRoot,
    turns,
    toolCalls,
    approvals,
    replies: turns.map((t) => t.reply).join("\n"),
  };

  const checks: RunResult["checks"] = [];
  for (const check of scenario.checks) {
    let result;
    try {
      result = await check.run(ctx);
    } catch (err) {
      result = { pass: false, detail: `check crashed: ${err instanceof Error ? err.message : String(err)}` };
    }
    checks.push({ id: check.id, description: check.description, must: check.must ?? false, weight: check.weight ?? 1, ...result });
  }

  const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
  const score = totalWeight ? checks.filter((c) => c.pass).reduce((s, c) => s + c.weight, 0) / totalWeight : 0;
  const passed = !error && checks.every((c) => c.pass || !c.must) && turns.length === scenario.turns.length && !turns.some((t) => t.cancelled);

  await writeTranscript(join(outDir, "transcripts"), `${scenario.id}-run${run}`, events, session?.screen() ?? undefined);
  const result: RunResult = {
    scenarioId: scenario.id,
    title: scenario.title,
    level: scenario.level,
    run,
    model: settings.model,
    passed,
    score,
    checks,
    metrics: computeMetrics(events, turns, approvals),
    turns,
    toolCalls,
    approvals,
    workspace: process.env.EVAL_KEEP ? platform.workspace : "(removed)",
    error,
    faultsInjected: platform.faultStats?.().injected,
  };

  await session?.close();
  await platform.close();
  return result;
}
