import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Metrics } from "./metrics.js";
import { redact, redactDeep } from "./secrets.js";
import type { ApprovalRecord, CheckResult, RecordedEvent, ToolCall, TurnOutcome } from "./types.js";

export type RunResult = {
  scenarioId: string;
  title: string;
  level: number;
  run: number;
  model: string;
  passed: boolean;
  /** Weighted share of checks that passed, 0–1. */
  score: number;
  checks: Array<{ id: string; description: string; must: boolean; weight: number } & CheckResult>;
  metrics: Metrics;
  turns: TurnOutcome[];
  toolCalls: ToolCall[];
  approvals: ApprovalRecord[];
  workspace: string;
  error?: string;
  /** Chat requests the fault proxy failed on purpose (only when EVAL_FAULT_RATE is set). */
  faultsInjected?: number;
};

export type Summary = {
  model: string;
  startedAt: string;
  runs: number;
  passed: number;
  failed: number;
  meanScore: number;
  byLevel: Record<string, { runs: number; passed: number }>;
};

export function summarize(model: string, startedAt: string, results: RunResult[]): Summary {
  const byLevel: Summary["byLevel"] = {};
  for (const r of results) {
    const key = `L${r.level}`;
    byLevel[key] ??= { runs: 0, passed: 0 };
    byLevel[key]!.runs++;
    if (r.passed) byLevel[key]!.passed++;
  }
  return {
    model,
    startedAt,
    runs: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    meanScore: results.length ? results.reduce((s, r) => s + r.score, 0) / results.length : 0,
    byLevel,
  };
}

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function renderMarkdown(summary: Summary, results: RunResult[]): string {
  const lines: string[] = [
    `# Agentic eval — ${summary.model}`,
    "",
    `${summary.startedAt} · ${summary.passed}/${summary.runs} passed · mean score ${(summary.meanScore * 100).toFixed(0)}%`,
    "",
    "| Level | Passed |",
    "|---|---|",
    ...Object.entries(summary.byLevel).sort().map(([k, v]) => `| ${k} | ${v.passed}/${v.runs} |`),
    "",
    "| Scenario | Run | Result | Score | Tools | Errors | Repeats | Guards | Net retries | Denied | Time | Tokens in/out |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const r of results) {
    const m = r.metrics;
    lines.push(
      `| ${r.scenarioId} | ${r.run} | ${r.passed ? "✅ pass" : "❌ fail"}${m.cancelledTurns ? " (cut)" : ""} | ${(r.score * 100).toFixed(0)}% | ${m.toolCalls} | ${m.toolErrors} | ${m.longestRepeat > 1 ? `×${m.longestRepeat}` : "–"} | ${Object.entries(m.guards).map(([k, v]) => `${k}×${v}`).join(", ") || "–"} | ${r.faultsInjected !== undefined ? `${m.providerRetries} of ${r.faultsInjected} faults` : m.providerRetries || "–"} | ${m.approvalsDenied}/${m.approvalsAsked} | ${secs(m.durationMs)} | ${m.inputTokens}/${m.outputTokens} |`,
    );
  }
  const failed = results.filter((r) => !r.passed);
  if (failed.length) {
    lines.push("", "## Failures", "");
    for (const r of failed) {
      lines.push(`### ${r.scenarioId} (run ${r.run})`);
      if (r.error) lines.push(`- error: ${r.error}`);
      for (const t of r.turns.filter((t) => t.cancelled)) lines.push(`- turn cut: ${t.cancelled} after ${secs(t.durationMs)}`);
      for (const c of r.checks.filter((c) => !c.pass)) lines.push(`- ${c.must ? "**must** " : ""}${c.description}${c.detail ? `\n  \`\`\`\n  ${c.detail.replace(/\n/g, "\n  ")}\n  \`\`\`` : ""}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

export async function writeReport(outDir: string, summary: Summary, results: RunResult[]): Promise<{ json: string; markdown: string }> {
  await mkdir(outDir, { recursive: true });
  const json = join(outDir, "results.json");
  const markdown = join(outDir, "report.md");
  await writeFile(json, redact(JSON.stringify(redactDeep({ summary, results }), null, 2)));
  await writeFile(markdown, redact(renderMarkdown(summary, results)));
  return { json, markdown };
}

/** Transcript for one run, for reading what the model actually did. */
export async function writeTranscript(outDir: string, name: string, events: RecordedEvent[], screen?: string[]): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const lines = events
    .filter((e) => ["tool.execute", "provider.retry", "tool.approval.requested", "tool.approval.resolved", "turn.start", "turn.end", "chat.final"].includes(e.event))
    .map((e) => `${String((e.t / 1000).toFixed(1)).padStart(7)}s  ${e.event}  ${JSON.stringify(e.payload).slice(0, 400)}`);
  await writeFile(join(outDir, `${name}.log`), redact(lines.join("\n")));
  // What the TUI was showing when the run ended (tui driver only).
  if (screen) await writeFile(join(outDir, `${name}.screen.txt`), redact(screen.join("\n")));
}
