import { spawn } from "node:child_process";

const MAX_OUTPUT = 20_000;

export function truncate(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_OUTPUT) return { text, truncated: false };
  return { text: text.slice(0, MAX_OUTPUT), truncated: true };
}

export type HeadlessRunResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
};

/**
 * Runs a CLI to completion (no pty, no stdin) and captures stdout/stderr.
 * Unlike `run_command`'s `execAsync`, this uses `spawn` directly so a
 * timeout can actually kill the process tree rather than just abandoning a
 * buffered promise — a headless `claude`/`agy` call has no human to notice
 * a hang.
 */
export function runHeadless(
  command: string,
  args: string[],
  opts: { cwd?: string; timeoutMs: number; signal?: AbortSignal },
): Promise<HeadlessRunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const killTimer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      // Belt-and-suspenders: some CLIs ignore SIGTERM while mid-request.
      setTimeout(() => child.kill("SIGKILL"), 3000);
    }, opts.timeoutMs);

    // Optional — invoke_cli (the chat tool) has no cancellation signal to
    // wire up today, but a workflow node's `agent.ask` runs under a real
    // AbortSignal (workflows.cancel / the node's own timeout) and, without
    // this, aborting would only stop the *caller* from waiting — the CLI
    // subprocess itself would keep running orphaned in the background.
    const onAbort = () => {
      timedOut = false; // not a timeout — distinct from the timer above
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 3000);
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr?.on("data", (chunk) => (stderr += chunk.toString()));

    child.on("error", (err) => {
      clearTimeout(killTimer);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve({ stdout, stderr: stderr || err.message, exitCode: null, timedOut });
    });

    child.on("close", (code) => {
      clearTimeout(killTimer);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve({ stdout, stderr, exitCode: code, timedOut });
    });
  });
}

/**
 * `--output-format json` is requested from both CLIs, but the exact schema
 * hasn't been verified against real output yet (Fase 4 of the plan) — stay
 * lenient rather than assume a shape. Tries a handful of common field names
 * used for "the final text reply" across CLI tools; falls back to the raw
 * stdout (still useful to the orchestrator, just unparsed) if JSON parsing
 * fails or none of those fields are present.
 */
export function extractReply(stdout: string): { reply: string; parsed?: Record<string, unknown> } {
  const trimmed = stdout.trim();
  if (!trimmed) return { reply: "" };
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    for (const key of ["result", "response", "text", "content", "message", "reply"]) {
      const value = parsed[key];
      if (typeof value === "string" && value.length > 0) return { reply: value, parsed };
    }
    return { reply: trimmed, parsed };
  } catch {
    return { reply: trimmed };
  }
}

/**
 * Best-effort extraction of a conversation/session id from parsed JSON
 * output — needed for `agy`, which (unlike `claude`) has no flag to *set*
 * a session id up front, only to resume one. Unverified against real output
 * (Fase 4); returns undefined rather than guessing when nothing matches.
 */
export function extractSessionId(parsed: Record<string, unknown> | undefined): string | undefined {
  if (!parsed) return undefined;
  for (const key of ["conversation_id", "conversationId", "session_id", "sessionId", "id"]) {
    const value = parsed[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}
