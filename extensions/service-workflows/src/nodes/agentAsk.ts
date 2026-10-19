import { randomUUID } from "node:crypto";
import { extractReply, runHeadless, truncate, type DelegateCli } from "@yggdrasil/tool-cli-delegate";
import type { NodeExecutor } from "@yggdrasil/workflows";

const DEFAULT_TIMEOUT_MS = 5 * 60_000;

/**
 * `agent.ask` — a one-shot completion, not an ongoing chat
 * (workflows-design.md §4/§6.3's `{prompt, provider?, model?, outputFormat?}`).
 * There is no first-party Anthropic/OpenAI `ProviderPlugin` registered in
 * this repo (only provider-ollama/provider-openai-compat) — Claude access
 * goes exclusively through the user's local `claude` CLI, headless
 * (@yggdrasil/tool-cli-delegate, the same mechanism the `invoke_cli` chat
 * tool already uses, flags verified against a real `--help` run there). This
 * node reuses that directly instead of inventing a second integration path,
 * at the cost of two things the original design assumed:
 * (a) no `tools` allowlist param — the delegated CLI has its own full local
 * tool access regardless of anything this node could pass it, so a
 * fine-grained allowlist would be theater, not a real restriction (the
 * node's own fixed `moderate` riskLevel + the workflow grant is the real
 * gate — see nodeTypes.ts); (b) no image/`ContentPartImage` attachments —
 * the CLI's headless `-p` mode takes a plain text prompt only, and no node
 * in this build produces an `ArtifactRef` yet anyway.
 *
 * Every call starts a fresh CLI session (no resumed conversation across
 * workflow runs, unlike `invoke_cli`) — matches "prompt in, text out", not a
 * stateful chat.
 */
export const agentAskExecutor: NodeExecutor = async ({ params, signal }) => {
  const prompt = String(params.prompt ?? "").trim();
  if (!prompt) throw new Error("agent.ask node requires a non-empty `prompt` param");

  // `provider` (workflows-design.md's param name) maps onto the two CLIs
  // this repo can actually delegate to — "claude" is the default per §6.3.
  const providerParam = typeof params.provider === "string" ? params.provider.toLowerCase() : "claude";
  const cli: DelegateCli = providerParam === "agy" || providerParam === "antigravity" ? "agy" : "claude";
  const model = typeof params.model === "string" && params.model ? params.model : undefined;
  const effort = typeof params.effort === "string" && params.effort ? params.effort : undefined;
  const outputFormat = params.outputFormat === "json" ? "json" : "text";
  const timeoutMs = typeof params.timeoutMs === "number" && params.timeoutMs > 0 ? params.timeoutMs : DEFAULT_TIMEOUT_MS;
  const cwd = typeof params.cwd === "string" && params.cwd ? params.cwd : undefined;

  const args =
    cli === "claude"
      ? ["-p", "--output-format", "json", "--permission-prompts", "none", ...(model ? ["--model", model] : []), ...(effort ? ["--effort", effort] : []), "--session-id", randomUUID(), prompt]
      : ["-p", "--output-format", "json", ...(model ? ["--model", model] : []), ...(effort ? ["--effort", effort] : []), "--mode", "plan", prompt];

  const result = await runHeadless(cli, args, { cwd, timeoutMs, signal });

  if (result.timedOut) throw new Error(`${cli} timed out after ${timeoutMs}ms and was killed`);
  if (signal.aborted) throw new Error("aborted");
  if (result.exitCode !== 0) {
    const err = truncate(result.stderr || result.stdout || `${cli} exited with code ${result.exitCode}`);
    throw new Error(`${cli}: ${err.text}`);
  }

  const { reply } = extractReply(result.stdout);
  const out = truncate(reply);

  if (outputFormat === "json") {
    try {
      return { handle: "out", output: { provider: cli, reply: JSON.parse(out.text), replyTruncated: out.truncated } };
    } catch {
      return { handle: "out", output: { provider: cli, reply: out.text, replyTruncated: out.truncated, jsonParseError: true } };
    }
  }
  return { handle: "out", output: { provider: cli, reply: out.text, replyTruncated: out.truncated } };
};
