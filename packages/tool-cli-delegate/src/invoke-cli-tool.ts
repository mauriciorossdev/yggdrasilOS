import { randomUUID } from "node:crypto";
import { defineTool } from "@yggdrasil/tools-sdk";
import { extractReply, extractSessionId, runHeadless, truncate } from "./headless-run.js";
import {
  clearStoredSessionId,
  getStoredSessionId,
  setStoredSessionId,
  type DelegateCli,
} from "./session-store.js";

const DEFAULT_TIMEOUT_MS = 5 * 60_000; // matches agy's own --print-timeout default (5m0s)

/**
 * Builds the headless invocation for one CLI. Both `claude` and `agy` were
 * confirmed via a real `--help` run (Fase 0 of the plan doc) to support a
 * one-shot `-p/--print` mode plus `--output-format json`. Neither has a way
 * to answer an interactive permission prompt when run headless/no-TTY — so
 * deliberately no `--dangerously-skip-permissions` here: our own
 * moderate-risk approval already gates the whole call, and the CLI denying
 * its own risky internal actions by default is the safer v1 posture (see
 * plan doc's Fase 0 decision). This can be revisited per-call later via an
 * explicit param if that turns out too restrictive in practice.
 */
function buildArgs(
  cli: DelegateCli,
  args: {
    task: string;
    resumeId?: string;
    model?: string;
    effort?: string;
    mode?: string;
    addDirs?: string[];
    newSessionId?: string; // claude only — minted by us, not the CLI
  },
): string[] {
  const addDirFlags = (args.addDirs ?? []).flatMap((dir) => ["--add-dir", dir]);

  if (cli === "claude") {
    const out = ["-p", "--output-format", "json", "--permission-prompts", "none"];
    if (args.model) out.push("--model", args.model);
    if (args.effort) out.push("--effort", args.effort);
    out.push(...addDirFlags);
    if (args.resumeId) out.push("--resume", args.resumeId);
    else if (args.newSessionId) out.push("--session-id", args.newSessionId);
    out.push(args.task);
    return out;
  }

  // agy
  const out = ["-p", "--output-format", "json"];
  if (args.model) out.push("--model", args.model);
  if (args.effort) out.push("--effort", args.effort);
  out.push("--mode", args.mode ?? "plan");
  out.push(...addDirFlags);
  if (args.resumeId === "__continue__") out.push("--continue");
  else if (args.resumeId) out.push("--conversation", args.resumeId);
  out.push(args.task);
  return out;
}

export const invokeCliTool = defineTool({
  name: "invoke_cli",
  description:
    "Delegates a coding/filesystem task to the user's own local CLI coding agent running on this machine " +
    '(claude = Claude Code, agy = Antigravity), headless, and returns its final reply. Unlike invoke_agent ' +
    "(which delegates to another *configured Yggdrasil agent*), this hands the task to a real, independent " +
    "coding CLI with its own tools, model, and filesystem/shell access on the user's machine — use it for " +
    "real code changes, file edits, or running project tooling, not for quick questions a local model can " +
    "answer directly. Conversation context is preserved automatically across calls to the same cli (it's " +
    "one ongoing chat with that CLI, not a fresh process each time) — you don't need to repeat prior " +
    "context in `task`, just describe the next step. Pass `resetSession: true` only when starting a " +
    "genuinely unrelated task and the old context would confuse it. Requires user approval before running.",
  parameters: {
    type: "object",
    properties: {
      cli: { type: "string", enum: ["claude", "agy"], description: "Which local CLI to delegate to." },
      task: { type: "string", description: "Self-contained description of the next step for the CLI to do." },
      cwd: { type: "string", description: "Working directory for the CLI (defaults to this project's root)." },
      addDirs: {
        type: "array",
        items: { type: "string" },
        description: "Extra directories to grant the CLI access to, beyond cwd.",
      },
      model: { type: "string", description: "Override model for this call." },
      effort: { type: "string", description: "Override reasoning effort for this call." },
      mode: { type: "string", enum: ["accept-edits", "plan"], description: "agy only. Defaults to plan (safer)." },
      timeoutMs: { type: "number", description: "Kill the CLI if it runs longer than this (default 5 minutes)." },
      resetSession: {
        type: "boolean",
        description: "Start a brand-new conversation with this cli instead of resuming the ongoing one.",
      },
    },
    required: ["cli", "task"],
  },
  riskLevel: "moderate",
  async execute(ctx, rawArgs) {
    const cli = rawArgs.cli as DelegateCli;
    const task = String(rawArgs.task ?? "").trim();
    if (cli !== "claude" && cli !== "agy") throw new Error('invoke_cli: cli must be "claude" or "agy"');
    if (!task) throw new Error("invoke_cli: task is required");

    const workspaceRoot = ctx.workspaceRoot;
    if (!workspaceRoot) throw new Error("invoke_cli: no workspaceRoot on this context");

    if (rawArgs.resetSession) await clearStoredSessionId(workspaceRoot, cli);

    const existingSessionId = await getStoredSessionId(workspaceRoot, cli);
    const mintedSessionId = cli === "claude" && !existingSessionId ? randomUUID() : undefined;

    const args = buildArgs(cli, {
      task,
      resumeId: existingSessionId,
      newSessionId: mintedSessionId,
      model: rawArgs.model ? String(rawArgs.model) : undefined,
      effort: rawArgs.effort ? String(rawArgs.effort) : undefined,
      mode: rawArgs.mode ? String(rawArgs.mode) : undefined,
      addDirs: Array.isArray(rawArgs.addDirs) ? rawArgs.addDirs.map(String) : undefined,
    });

    const timeoutMs = typeof rawArgs.timeoutMs === "number" && rawArgs.timeoutMs > 0 ? rawArgs.timeoutMs : DEFAULT_TIMEOUT_MS;
    const cwd = rawArgs.cwd ? String(rawArgs.cwd) : workspaceRoot;

    const result = await runHeadless(cli, args, { cwd, timeoutMs });

    if (result.timedOut) {
      return { delegated: false, cli, error: `${cli} timed out after ${timeoutMs}ms and was killed.` };
    }
    if (result.exitCode !== 0) {
      const err = truncate(result.stderr || result.stdout || `${cli} exited with code ${result.exitCode}`);
      return { delegated: false, cli, error: err.text, exitCode: result.exitCode };
    }

    const { reply, parsed } = extractReply(result.stdout);
    const out = truncate(reply);

    // Persist session id for next call. claude: the id we minted this call
    // (first call) or whatever we already had (resumed call) — claude
    // doesn't rotate it. agy: whatever we resumed with, or a freshly
    // discovered id from this call's output, or the "__continue__" fallback
    // when no id is present anywhere in the response (see extractSessionId).
    if (cli === "claude") {
      await setStoredSessionId(workspaceRoot, cli, existingSessionId ?? mintedSessionId!);
    } else {
      const discovered = existingSessionId ?? extractSessionId(parsed) ?? "__continue__";
      await setStoredSessionId(workspaceRoot, cli, discovered);
    }

    return {
      delegated: true,
      cli,
      reply: out.text,
      replyTruncated: out.truncated,
      exitCode: result.exitCode,
    };
  },
});
