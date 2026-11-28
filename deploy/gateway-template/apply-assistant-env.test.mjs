// Run: node --test deploy/gateway-template/
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { applyAssistantEnv } from "./apply-assistant-env.mjs";

const template = JSON.parse(readFileSync(new URL("./yggdrasil.config.json", import.meta.url), "utf8"));
const assistant = (config) => config.agents.find((a) => a.id === "assistant");

test("the template makes the assistant the default agent, so no chat falls into echo", () => {
  assert.equal(template.defaultAgent, "assistant");
});

test("no ASSISTANT_* variable keeps the template's Anthropic + Haiku", () => {
  const { config, warnings } = applyAssistantEnv(template, {});
  assert.equal(config, template);
  assert.deepEqual(warnings, []);
});

test("provider and model come from the variables", () => {
  const { config } = applyAssistantEnv(template, { ASSISTANT_PROVIDER: "openai-compat", ASSISTANT_MODEL: "gpt-4.1-mini", OPENAI_API_KEY: "k" });
  assert.equal(assistant(config).provider, "openai-compat");
  assert.equal(assistant(config).model, "gpt-4.1-mini");
  assert.equal(assistant(template).provider, "anthropic", "the input is not mutated");
});

test("switching provider without a model uses that provider's default, not the old model", () => {
  const { config } = applyAssistantEnv(template, { ASSISTANT_PROVIDER: "openai-compat", OPENAI_API_KEY: "k" });
  assert.equal(assistant(config).model, "gpt-4o-mini");
});

test("only the model changes the model and keeps the provider", () => {
  const { config } = applyAssistantEnv(template, { ASSISTANT_MODEL: "claude-sonnet-4-5", ANTHROPIC_API_KEY: "k" });
  assert.equal(assistant(config).provider, "anthropic");
  assert.equal(assistant(config).model, "claude-sonnet-4-5");
});

test("a base URL goes to that provider's config", () => {
  const { config } = applyAssistantEnv(template, {
    ASSISTANT_PROVIDER: "openai-compat",
    ASSISTANT_MODEL: "gpt-oss:120b",
    ASSISTANT_BASE_URL: "https://ollama.com/v1",
    OLLAMA_API_KEY: "k",
  });
  assert.equal(config.providers["openai-compat"].baseUrl, "https://ollama.com/v1");
});

test("bad values fail the deploy with a readable message", () => {
  assert.throws(() => applyAssistantEnv(template, { ASSISTANT_PROVIDER: "gemini" }), /not supported/);
  assert.throws(() => applyAssistantEnv(template, { ASSISTANT_PROVIDER: "ollama" }), /ASSISTANT_MODEL is required/);
});

test("a missing API key or Ollama host is warned about", () => {
  const { warnings } = applyAssistantEnv(template, { ASSISTANT_PROVIDER: "ollama", ASSISTANT_MODEL: "qwen3" });
  assert.ok(warnings.some((w) => w.includes("ASSISTANT_BASE_URL")));
  const noKey = applyAssistantEnv(template, { ASSISTANT_MODEL: "claude-sonnet-4-5" });
  assert.ok(noKey.warnings.some((w) => w.includes("ANTHROPIC_API_KEY")));
});

test("the key warning follows the endpoint: a vendor's variable doesn't count elsewhere", () => {
  const warned = (env) => applyAssistantEnv(template, { ASSISTANT_PROVIDER: "openai-compat", ...env }).warnings.join(" ");
  assert.match(warned({ OLLAMA_API_KEY: "k" }), /set OPENAI_API_KEY/);
  assert.equal(warned({ ASSISTANT_BASE_URL: "https://ollama.com/v1", OLLAMA_API_KEY: "k" }), "");
  assert.match(warned({ ASSISTANT_BASE_URL: "https://openrouter.ai/api/v1", OPENAI_API_KEY: "k" }), /set YGGDRASIL_OPENAI_API_KEY/);
});

const script = fileURLToPath(new URL("./apply-assistant-env.mjs", import.meta.url));
const run = (file, env) => spawnSync(process.execPath, [script, file], { env: { PATH: process.env.PATH, ...env }, encoding: "utf8" });

test("without ASSISTANT_* the script never touches the file, even one JSON.parse rejects", () => {
  const file = join(mkdtempSync(join(tmpdir(), "ygg-")), "yggdrasil.config.json");
  writeFileSync(file, "{ hand-edited, not strict JSON }");
  const res = run(file, {});
  assert.equal(res.status, 0);
  assert.equal(readFileSync(file, "utf8"), "{ hand-edited, not strict JSON }");
});

test("with a variable it rewrites the config and logs the choice", () => {
  const file = join(mkdtempSync(join(tmpdir(), "ygg-")), "yggdrasil.config.json");
  writeFileSync(file, JSON.stringify(template));
  const res = run(file, { ASSISTANT_MODEL: "claude-sonnet-4-5", ANTHROPIC_API_KEY: "k" });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /provider=anthropic model=claude-sonnet-4-5/);
  assert.equal(assistant(JSON.parse(readFileSync(file, "utf8"))).model, "claude-sonnet-4-5");
  assert.equal(run(file, { ASSISTANT_PROVIDER: "gemini" }).status, 1);
});
