#!/usr/bin/env node
// Side-by-side table of several models from one comparison run: results/<runId>/<model>/results.json
//   node test/agentic/compare.mjs <runId>      (docker/run.mjs calls this after an EVAL_MODELS run)
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const results = resolve(dirname(fileURLToPath(import.meta.url)), "results");
const runId = process.argv[2];
if (!runId) {
  console.error("usage: compare.mjs <runId>");
  process.exit(1);
}
const dir = join(results, runId);
if (!existsSync(dir)) {
  console.error(`no results in ${dir}`);
  process.exit(1);
}

const models = readdirSync(dir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, "results.json")))
  .map((e) => ({ name: e.name, data: JSON.parse(readFileSync(join(dir, e.name, "results.json"), "utf8")) }));
if (models.length === 0) {
  console.error("no model produced a results.json");
  process.exit(1);
}

const scenarios = [...new Set(models.flatMap((m) => m.data.results.map((r) => r.scenarioId)))];
const cell = (model, id) => {
  const runs = model.data.results.filter((r) => r.scenarioId === id);
  if (runs.length === 0) return "–";
  const passed = runs.filter((r) => r.passed).length;
  const score = Math.round((runs.reduce((s, r) => s + r.score, 0) / runs.length) * 100);
  const secs = Math.round(runs.reduce((s, r) => s + r.metrics.durationMs, 0) / runs.length / 1000);
  return `${passed === runs.length ? "✅" : passed === 0 ? "❌" : "◐"} ${score}% · ${runs.length > 1 ? `${passed}/${runs.length} · ` : ""}${secs}s`;
};

const lines = [
  `# Agentic eval — model comparison (${runId})`,
  "",
  `| Scenario | ${models.map((m) => m.name).join(" | ")} |`,
  `|---|${models.map(() => "---").join("|")}|`,
  ...scenarios.map((id) => `| ${id} | ${models.map((m) => cell(m, id)).join(" | ")} |`),
  `| **passed** | ${models.map((m) => `**${m.data.summary.passed}/${m.data.summary.runs}**`).join(" | ")} |`,
  `| mean score | ${models.map((m) => `${Math.round(m.data.summary.meanScore * 100)}%`).join(" | ")} |`,
  `| tool calls | ${models.map((m) => m.data.results.reduce((s, r) => s + r.metrics.toolCalls, 0)).join(" | ")} |`,
  `| provider retries | ${models.map((m) => { const retries = m.data.results.reduce((s, r) => s + (r.metrics.providerRetries ?? 0), 0); const faults = m.data.results.reduce((s, r) => s + (r.faultsInjected ?? 0), 0); return faults ? `${retries} (of ${faults} faults)` : retries; }).join(" | ")} |`,
  `| guard nudges | ${models.map((m) => m.data.results.reduce((s, r) => s + Object.values(r.metrics.guards ?? {}).reduce((a, b) => a + b, 0), 0)).join(" | ")} |`,
  `| tokens in / out | ${models.map((m) => { const r = m.data.results; return `${Math.round(r.reduce((s, x) => s + x.metrics.inputTokens, 0) / 1000)}k / ${Math.round(r.reduce((s, x) => s + x.metrics.outputTokens, 0) / 1000)}k`; }).join(" | ")} |`,
  `| total time | ${models.map((m) => `${Math.round(m.data.results.reduce((s, r) => s + r.metrics.durationMs, 0) / 1000)}s`).join(" | ")} |`,
  "",
];
const out = join(dir, "comparison.md");
writeFileSync(out, lines.join("\n"));
console.log(lines.join("\n"));
console.log(`\n[eval] comparison: ${out}`);
