#!/usr/bin/env node
// Runs the agentic evals inside a throwaway Docker container (see ../README.md, "Sandbox").
//
//   pnpm eval:agentic:docker                 build the image if needed, then run
//   pnpm eval:agentic:docker -- --rebuild    force a rebuild (BuildKit still reuses cached layers)
//   pnpm eval:agentic:docker -- --selftest   show what the container can and cannot reach, run nothing
//   EVAL_MODELS=gemma4:e4b,qwen3.5:9b pnpm eval:agentic:docker   one container per model, then a comparison table
//
// Configuration is the same EVAL_* variables as the host run. Extra arguments go to vitest.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const image = process.env.EVAL_DOCKER_IMAGE || "yggdrasil-eval:local";
const resultsDir = join(repoRoot, "test", "agentic", "results");
const APP_DIR = "/home/node/app";

const args = process.argv.slice(2).filter((a) => a !== "--");
const flag = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
};
const rebuild = flag("--rebuild");
const selftest = flag("--selftest");
const dryRun = flag("--dry-run"); // print the docker command that would run (never contains the API key) and stop

// Same lookup as lib/apiKey.ts: EVAL_OLLAMA_API_KEY_FILE, else ~/.config/yggdrasil/ollama-cloud.key (outside the repo).
function readKeyFile() {
  const explicit = process.env.EVAL_OLLAMA_API_KEY_FILE;
  const path = explicit || join(homedir(), ".config", "yggdrasil", "ollama-cloud.key");
  try {
    if (statSync(path).mode & 0o077) console.warn(`[eval:docker] ${path} is readable by other users; run: chmod 600 ${path}`);
    return readFileSync(path, "utf8").trim() || undefined;
  } catch (err) {
    if (explicit) fail(`EVAL_OLLAMA_API_KEY_FILE=${explicit} cannot be read: ${err.message}`);
    return undefined;
  }
}

function fail(message) {
  console.error(`[eval:docker] ${message}`);
  process.exit(1);
}

const docker = (cmdArgs, opts = {}) => spawnSync("docker", cmdArgs, { encoding: "utf8", ...opts });

if (!dryRun && docker(["info", "--format", "{{.ServerVersion}}"]).status !== 0) {
  fail("Docker is not available. Start Docker Desktop (or the docker daemon) and try again.");
}

const haveImage = dryRun || docker(["image", "inspect", image]).status === 0;
if (rebuild || !haveImage) {
  console.log(`[eval:docker] building ${image} (first time takes a few minutes; later builds reuse the dependency layer)…`);
  const build = spawnSync(
    "docker",
    ["build", "-f", "test/agentic/docker/Dockerfile", "-t", image, "."],
    { cwd: repoRoot, stdio: "inherit", env: { ...process.env, DOCKER_BUILDKIT: "1" } },
  );
  if (build.status !== 0) fail("image build failed");
}

// The model's Ollama lives on the host; from inside the container that is host.docker.internal.
const ollamaUrl = (process.env.EVAL_OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/\/(127\.0\.0\.1|localhost)(?=[:/]|$)/, "//host.docker.internal");

// Everything the eval reads is EVAL_*; forward them, with the Ollama URL rewritten and the in-container paths fixed.
const envFlags = [];
for (const [key, value] of Object.entries(process.env)) {
  if (!key.startsWith("EVAL_") || value === undefined) continue;
  if (["EVAL_TOTAL_TOKENS", "EVAL_OLLAMA_URL", "EVAL_OLLAMA_API_KEY", "EVAL_OUT", "EVAL_DOCKER_IMAGE", "EVAL_DOCKER_MEMORY", "EVAL_KEEP", "EVAL_MODEL", "EVAL_MODELS", "EVAL_RUN_ID"].includes(key)) continue;
  envFlags.push("-e", `${key}=${value}`);
}
envFlags.push("-e", `EVAL_OLLAMA_URL=${ollamaUrl}`);
// Ollama Cloud key: `-e NAME` with no value makes Docker read it from this process's environment, so the key
// never appears in the command line (visible in `ps`) or in this script's output.
// The default key file is only for Ollama Cloud: it is not passed along when the eval talks to a local/LAN server.
const targetsOllamaCloud = (() => {
  try {
    return /(^|\.)ollama\.com$/.test(new URL(process.env.EVAL_OLLAMA_URL || "http://127.0.0.1:11434").hostname);
  } catch {
    return false;
  }
})();
const explicitKey = process.env.EVAL_OLLAMA_API_KEY || process.env.OLLAMA_API_KEY;
const cloudKey = explicitKey || (process.env.EVAL_OLLAMA_API_KEY_FILE || targetsOllamaCloud ? readKeyFile() : undefined);
if (cloudKey) envFlags.push("-e", "EVAL_OLLAMA_API_KEY");

mkdirSync(resultsDir, { recursive: true });

const isolation = [
  "--rm",
  "--init",
  // Nothing from the host except the results folder (below) and Ollama over the network.
  "--cap-drop=ALL",
  "--security-opt=no-new-privileges",
  `--memory=${process.env.EVAL_DOCKER_MEMORY || "6g"}`,
  "--pids-limit=1024",
  // Docker Desktop provides host.docker.internal; on Linux it has to be mapped.
  "--add-host=host.docker.internal:host-gateway",
  "-v", `${resultsDir}:${APP_DIR}/test/agentic/results`,
];

const selftestArgs = [
  "run", ...isolation, "--entrypoint", "node", image, "-e", `
    const fs = require("node:fs");
    const probe = (label, fn) => { try { console.log(label.padEnd(44), fn()); } catch (e) { console.log(label.padEnd(44), "blocked (" + e.code + ")"); } };
    probe("user", () => require("node:os").userInfo().username);
    probe("host home visible (/Users)", () => fs.existsSync("/Users") ? "VISIBLE" : "no");
    probe("host home visible (/host_mnt)", () => fs.existsSync("/host_mnt") ? "VISIBLE" : "no");
    probe("write outside the app dir (/etc)", () => { fs.writeFileSync("/etc/eval-probe", "x"); return "WRITABLE"; });
    probe("write to the results folder", () => { fs.writeFileSync("${APP_DIR}/test/agentic/results/.probe", "x"); fs.unlinkSync("${APP_DIR}/test/agentic/results/.probe"); return "ok (the only mount)"; });
    fetch("${ollamaUrl}/api/tags", { signal: AbortSignal.timeout(4000) })
      .then((r) => console.log("ollama at ${ollamaUrl}".padEnd(44), r.ok ? "reachable" : "HTTP " + r.status))
      .catch(() => console.log("ollama at ${ollamaUrl}".padEnd(44), "NOT reachable (on Linux start Ollama with OLLAMA_HOST=0.0.0.0)"));
  `,
];

const runContainer = (extraEnv) =>
  new Promise((resolveRun) => {
    if (dryRun) {
      console.log(["docker", "run", ...isolation, ...envFlags, ...extraEnv, image, ...args].join(" "));
      resolveRun(0);
      return;
    }
    const child = spawn("docker", ["run", ...isolation, ...envFlags, ...extraEnv, image, ...args], {
      stdio: "inherit",
      env: { ...process.env, ...(cloudKey ? { EVAL_OLLAMA_API_KEY: cloudKey } : {}) },
    });
    child.on("exit", (code) => resolveRun(code ?? 1));
    process.on("SIGINT", () => child.kill("SIGINT"));
    process.on("SIGTERM", () => child.kill("SIGTERM"));
  });

if (selftest) {
  const child = spawn("docker", selftestArgs, { stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 1));
} else {
  // One model, or several: each gets its own fresh container so they cannot see each other's files.
  const models = (process.env.EVAL_MODELS || "").split(",").map((m) => m.trim()).filter(Boolean);
  if (models.length <= 1) {
    const model = models[0] || process.env.EVAL_MODEL || "gemma4:e4b";
    process.exit(await runContainer(["-e", `EVAL_MODEL=${model}`]));
  }

  const runId = `compare-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  let worst = 0;
  // Total token cap across models (paid endpoints): checked before each model from what the earlier ones used.
  const totalBudget = Number(process.env.EVAL_TOTAL_TOKENS || 0);
  let spentTokens = 0;
  const tokensOf = (model) => {
    try {
      const { results } = JSON.parse(readFileSync(join(resultsDir, runId, model.replace(/[^\w.-]+/g, "_"), "results.json"), "utf8"));
      return results.reduce((s, r) => s + r.metrics.inputTokens + r.metrics.outputTokens, 0);
    } catch {
      return 0;
    }
  };
  for (const model of [...new Set(models)]) {
    if (totalBudget > 0 && spentTokens >= totalBudget) {
      console.log(`\n[eval:docker] token budget reached (${spentTokens} ≥ ${totalBudget}); not running ${model} or the models after it`);
      break;
    }
    console.log(`\n[eval:docker] ── ${model} (${models.indexOf(model) + 1}/${models.length}) ──`);
    const code = await runContainer(["-e", `EVAL_MODEL=${model}`, "-e", `EVAL_RUN_ID=${runId}`]);
    worst = Math.max(worst, code);
    spentTokens += tokensOf(model);
    console.log(`[eval:docker] tokens so far: ${spentTokens}${totalBudget ? ` of ${totalBudget}` : ""}`);
  }
  const compare = spawnSync("node", [join(repoRoot, "test", "agentic", "compare.mjs"), runId], { stdio: "inherit" });
  process.exit(compare.status === 0 ? worst : 1);
}
