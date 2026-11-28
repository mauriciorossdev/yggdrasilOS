#!/usr/bin/env node
// Lets a deployment pick the assistant's provider and model with variables
// instead of rebuilding the image (connection-ux-review-2026-11-25.md):
//
//   ASSISTANT_PROVIDER  anthropic (default) | openai-compat | ollama
//   ASSISTANT_MODEL     model id; defaults per provider below
//   ASSISTANT_BASE_URL  optional endpoint (OpenAI-compatible server, Ollama host)
//
// The provider's API key keeps coming from its own variable (ANTHROPIC_API_KEY;
// for openai-compat it depends on the endpoint, see openAICompatKeyVars). Run by
// docker-entrypoint.sh on the config it just synced; exits non-zero on a bad
// value so a typo fails the deploy instead of answering "echo".
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Mirrors openAICompatKeyEnvVars in @yggdrasil/config: a vendor's key only goes to that vendor. */
function openAICompatKeyVars(baseUrl) {
  const own = "YGGDRASIL_OPENAI_API_KEY";
  let url;
  try {
    url = new URL(baseUrl || "https://api.openai.com/v1");
  } catch {
    return [own];
  }
  const host = url.hostname;
  if (host === "localhost" || host === "[::1]" || /^127(\.\d+){3}$/.test(host)) return ["OLLAMA_API_KEY", "OPENAI_API_KEY", own];
  const is = (domain) => url.protocol === "https:" && (host === domain || host.endsWith(`.${domain}`));
  if (is("openai.com")) return ["OPENAI_API_KEY", own];
  if (is("ollama.com")) return ["OLLAMA_API_KEY", own];
  return [own];
}

export const ASSISTANT_PROVIDERS = {
  anthropic: { defaultModel: "claude-haiku-4-5-20251001", keyVars: ["ANTHROPIC_API_KEY", "YGGDRASIL_ANTHROPIC_API_KEY"] },
  "openai-compat": { defaultModel: "gpt-4o-mini", keyVars: openAICompatKeyVars },
  ollama: { defaultModel: undefined, keyVars: [] },
};

const clean = (value) => (typeof value === "string" ? value.trim() : "");

/**
 * Returns `{ config, warnings }` with the assistant agent set from `env`, or
 * throws with a message meant for the deploy log. Without any ASSISTANT_*
 * variable the config comes back unchanged (the template's own choice).
 */
export function applyAssistantEnv(config, env) {
  const provider = clean(env.ASSISTANT_PROVIDER);
  const model = clean(env.ASSISTANT_MODEL);
  const baseUrl = clean(env.ASSISTANT_BASE_URL);
  const warnings = [];
  if (!provider && !model && !baseUrl) return { config, warnings };

  const agent = (config.agents ?? []).find((a) => a.id === "assistant");
  if (!agent) throw new Error('ASSISTANT_* is set but the config has no "assistant" agent.');

  const providerId = provider || agent.provider || "anthropic";
  const spec = ASSISTANT_PROVIDERS[providerId];
  if (!spec) {
    throw new Error(`ASSISTANT_PROVIDER="${providerId}" is not supported. Use one of: ${Object.keys(ASSISTANT_PROVIDERS).join(", ")}.`);
  }
  // A provider change without a model must not keep the old provider's model id.
  const modelId = model || (provider && provider !== agent.provider ? spec.defaultModel : agent.model ?? spec.defaultModel);
  if (!modelId) throw new Error(`ASSISTANT_MODEL is required with ASSISTANT_PROVIDER="${providerId}".`);
  if (providerId === "ollama" && !baseUrl) {
    warnings.push("ASSISTANT_PROVIDER=ollama without ASSISTANT_BASE_URL: it will look for Ollama on 127.0.0.1:11434 inside the container.");
  }
  const endpoint = baseUrl || config.providers?.[providerId]?.baseUrl;
  const keyVars = typeof spec.keyVars === "function" ? spec.keyVars(endpoint) : spec.keyVars;
  if (keyVars.length > 0 && !keyVars.some((name) => clean(env[name]))) {
    warnings.push(`No API key for ${providerId}: set ${keyVars[0]}.`);
  }

  const next = structuredClone(config);
  const nextAgent = next.agents.find((a) => a.id === "assistant");
  nextAgent.provider = providerId;
  nextAgent.model = modelId;
  if (baseUrl) next.providers = { ...next.providers, [providerId]: { ...next.providers?.[providerId], baseUrl } };
  return { config: next, warnings };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: apply-assistant-env.mjs <yggdrasil.config.json>");
    process.exit(2);
  }
  // Nothing to apply: leave the file alone, so a hand-kept config
  // (YGGDRASIL_KEEP_CONFIG=1) can never stop a deploy that didn't ask for this.
  if (!["ASSISTANT_PROVIDER", "ASSISTANT_MODEL", "ASSISTANT_BASE_URL"].some((name) => clean(process.env[name]))) process.exit(0);
  try {
    const { config, warnings } = applyAssistantEnv(JSON.parse(readFileSync(path, "utf8")), process.env);
    for (const w of warnings) console.warn(`Warning: ${w}`);
    writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
    const agent = (config.agents ?? []).find((a) => a.id === "assistant");
    if (agent) console.log(`Assistant: provider=${agent.provider} model=${agent.model}`);
  } catch (err) {
    console.error(`Assistant config: ${err.message}`);
    process.exit(1);
  }
}
