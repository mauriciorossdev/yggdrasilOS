import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ollamaModelCapabilities, ollamaReachable, type EvalSettings } from "./lib/platform.js";
import { parseFaults } from "./lib/faultProxy.js";
import { findApiKey } from "./lib/apiKey.js";
import { registerSecret } from "./lib/secrets.js";
import { summarize, writeReport, type RunResult } from "./lib/report.js";
import { DEFAULT_TURN_TIMEOUT_MS, runScenario } from "./lib/runScenario.js";
import { SCENARIOS, selectScenarios } from "./scenarios/index.js";

// Ollama Cloud key. Read once, kept in memory, and removed from the environment right away: the model has
// shell tools, and a variable left in process.env would be one `env` away from showing up in its output.
// Anything written to disk is redacted as well (lib/secrets.ts).
const lookup = findApiKey();
const ollamaUrlForKey = process.env.EVAL_OLLAMA_URL?.trim() || "http://127.0.0.1:11434";
const isOllamaCloud = (() => {
  try {
    return /(^|\.)ollama\.com$/.test(new URL(ollamaUrlForKey).hostname);
  } catch {
    return false;
  }
})();
// A key found only in the default key file is for Ollama Cloud: never hand it to any other host (a local
// server, a LAN machine). Naming the key explicitly (env var or EVAL_OLLAMA_API_KEY_FILE) is always honored.
const keyIsOnlyDefaultFile = lookup.source === "file" && !process.env.EVAL_OLLAMA_API_KEY_FILE;
const apiKey = keyIsOnlyDefaultFile && !isOllamaCloud ? undefined : lookup.key;
if (lookup.warning) console.warn(`[eval] ${lookup.warning}`);
delete process.env.EVAL_OLLAMA_API_KEY;
delete process.env.OLLAMA_API_KEY;
registerSecret(apiKey);

const model = process.env.EVAL_MODEL?.trim() || "gemma4:e4b";
const ollamaUrl = process.env.EVAL_OLLAMA_URL?.trim() || "http://127.0.0.1:11434";
const runs = Math.max(1, Number(process.env.EVAL_RUNS ?? 1));
const startedAt = new Date().toISOString();
const safeModel = model.replace(/[^\w.-]+/g, "_");
// EVAL_RUN_ID groups several models of one comparison under results/<id>/<model>/ (see docker/run.mjs).
const runId = process.env.EVAL_RUN_ID?.trim();
const outDir =
  process.env.EVAL_OUT?.trim() ||
  (runId
    ? join(process.cwd(), "test", "agentic", "results", runId, safeModel)
    : join(process.cwd(), "test", "agentic", "results", `${startedAt.replace(/[:.]/g, "-")}_${safeModel}`));

const settings: EvalSettings = {
  model,
  ollamaUrl,
  maxToolIterations: Number(process.env.EVAL_MAX_ITER ?? 25),
  approvalMode: process.env.EVAL_APPROVAL === "yolo" ? "yolo" : "auto",
  driver: process.env.EVAL_DRIVER === "tui" ? "tui" : "gateway",
  loopGuards: process.env.EVAL_LOOP_GUARDS !== "0",
  think: process.env.EVAL_THINK === "0" ? false : process.env.EVAL_THINK === "1" ? true : undefined,
  systemPrompt: process.env.EVAL_SYSTEM_PROMPT?.trim() || undefined,
  apiKey,
  // Chaos mode: EVAL_FAULT_RATE=0.3 fails ~30% of chat requests (statuses from EVAL_FAULTS, default 500,503,429,reset,502).
  faultRate: Number(process.env.EVAL_FAULT_RATE ?? 0) || undefined,
  faults: parseFaults(process.env.EVAL_FAULTS),
  faultSeed: process.env.EVAL_FAULT_SEED ? Number(process.env.EVAL_FAULT_SEED) : undefined,
  providerMaxRetries: process.env.EVAL_PROVIDER_RETRIES !== undefined && process.env.EVAL_PROVIDER_RETRIES !== "" ? Number(process.env.EVAL_PROVIDER_RETRIES) : undefined,
};

// Slow, networked scenarios (npm install) only run when asked for, so a casual `pnpm eval:agentic` stays quick.
const defaultFilter = process.env.EVAL_SCENARIOS ?? "-tag:slow";
const selected = selectScenarios(SCENARIOS, defaultFilter);

const inDocker = process.env.EVAL_IN_DOCKER === "1";
// "yolo" skips every approval prompt, including the policy that keeps the model inside its workspace. Only
// acceptable in the sandbox: on the host it would let the model run anything the user can.
if (settings.approvalMode === "yolo" && !inDocker && process.env.EVAL_ALLOW_HOST_YOLO !== "1") {
  throw new Error("EVAL_APPROVAL=yolo is only allowed in the Docker sandbox (pnpm eval:agentic:docker). Set EVAL_ALLOW_HOST_YOLO=1 to override on the host.");
}

const reach = await ollamaReachable(ollamaUrl, apiKey);
const reachable = reach.ok;
const capabilities = reachable ? await ollamaModelCapabilities(ollamaUrl, model, apiKey) : null;
// The scenarios are about using tools; a model without tool calling can only fail them all for the wrong reason.
const modelPresent = capabilities !== null && capabilities.includes("tools");
if (reach.status === 401 || reach.status === 403) console.warn(`[eval] ${ollamaUrl} rejected the API key (HTTP ${reach.status}) — skipping.`);
else if (!reachable) console.warn(`[eval] Ollama is not reachable at ${ollamaUrl}${apiKey ? "" : " (no API key set; Ollama Cloud needs EVAL_OLLAMA_API_KEY)"} — skipping.`);
else if (capabilities === null) console.warn(`[eval] Model "${model}" is not pulled in Ollama (ollama pull ${model}) — skipping.`);
else if (!modelPresent) console.warn(`[eval] Model "${model}" has no "tools" capability (it has: ${capabilities.join(", ") || "none"}) — skipping.`);
else console.log(`[eval] ${model} · ${selected.length} scenario(s) × ${runs} run(s) · sandbox: ${inDocker ? "docker" : "none (host)"} · auth: ${apiKey ? "api key" : "none"} · faults: ${settings.faultRate ? `${settings.faultRate * 100}%` : "off"} · guards: ${settings.loopGuards ? "on" : "off"} · think: ${settings.think ?? "model default"} · results → ${outDir}`);

const results: RunResult[] = [];

// Paid endpoints (Ollama Cloud) bill by tokens: stop starting new scenarios once this many (input + output)
// have been spent in this process. 0 / unset = no limit. A scenario already running is allowed to finish.
const tokenBudget = Number(process.env.EVAL_MAX_TOKENS ?? 0);
const tokensSpent = () => results.reduce((s, r) => s + r.metrics.inputTokens + r.metrics.outputTokens, 0);

describe.skipIf(!modelPresent)(`agentic eval · ${model} · ${settings.driver}`, () => {
  afterAll(async () => {
    if (results.length === 0) return;
    const summary = summarize(model, startedAt, results);
    const files = await writeReport(outDir, summary, results);
    console.log(`\n[eval] ${summary.passed}/${summary.runs} passed · mean score ${(summary.meanScore * 100).toFixed(0)}% · tokens ${tokensSpent()}${tokenBudget ? ` of ${tokenBudget} budget` : ""}\n[eval] report: ${files.markdown}`);
  });

  for (const scenario of selected) {
    for (let run = 1; run <= runs; run++) {
      const turnBudget = (scenario.budget?.timeoutMs ?? DEFAULT_TURN_TIMEOUT_MS) * scenario.turns.length;
      it(
        `L${scenario.level} ${scenario.id} #${run} — ${scenario.title}`,
        async (ctx) => {
          if (tokenBudget > 0 && tokensSpent() >= tokenBudget) {
            console.warn(`[eval] token budget reached (${tokensSpent()} ≥ ${tokenBudget}); skipping ${scenario.id} #${run}`);
            ctx.skip();
          }
          const result = await runScenario(scenario, { settings, run, outDir });
          results.push(result);
          const failedChecks = result.checks.filter((c) => !c.pass);
          // Surfaced as the test failure so a plain `vitest` run shows what went wrong without opening the report.
          expect(result.passed, [result.error, ...failedChecks.map((c) => `${c.must ? "[must] " : ""}${c.description}${c.detail ? `: ${c.detail}` : ""}`)].filter(Boolean).join("\n")).toBe(true);
        },
        // Model time + grading (builds, installs) + a minute of slack.
        turnBudget + 360_000,
      );
    }
  }
});
