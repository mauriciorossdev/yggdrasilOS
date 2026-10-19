import { definePlugin } from "@yggdrasil/sdk";
import { defineTool } from "@yggdrasil/tools-sdk";
import { runShellInSandbox } from "@yggdrasil/sandbox-runtime";
import type { YggdrasilConfig } from "@yggdrasil/config";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 300_000;

// Read-only / non-destructive command segments that skip the approval prompt.
// Anything not matched here still requires approval — this list only ever
// grants, never denies (fail closed on ambiguity).
const SAFE_SEGMENT_PATTERNS: RegExp[] = [
  /^sw_vers\b/,
  /^sysctl\s+-n\s+\S+$/,
  /^system_profiler\s+\S+$/,
  /^grep\b/,
  /^open\s+-a\s+("[^"]+"|'[^']+'|\S+)$/,
  /^pwd$/,
  /^whoami$/,
  /^date\b/,
  /^uname\b/,
  /^hostname$/,
  /^ls(\s+-\S+)*$/,
];

/**
 * Splits a command on top-level `&&` / `|` boundaries, respecting quotes (so a
 * `|` inside a quoted grep pattern isn't mistaken for a pipe). Returns null
 * (fail closed) on any other shell metacharacter outside quotes (`;`, `||`,
 * background `&`, backticks, `$`, redirection `<`/`>`) — those change control
 * flow or I/O in ways this allowlist doesn't reason about.
 */
function splitShellSequence(command: string): string[] | null {
  const segments: string[] = [];
  let buf = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      buf += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      buf += c;
      continue;
    }
    if (c === "&") {
      if (command[i + 1] === "&") {
        segments.push(buf);
        buf = "";
        i++;
        continue;
      }
      return null; // background `&` — not reasoned about, fail closed
    }
    if (c === "|") {
      if (command[i + 1] === "|") return null; // `||` — fail closed
      segments.push(buf);
      buf = "";
      continue;
    }
    if (";`$<>".includes(c)) return null; // subshells/redirection — fail closed
    buf += c;
  }
  if (quote) return null; // unterminated quote — fail closed
  segments.push(buf);
  return segments.map((s) => s.trim()).filter(Boolean);
}

function isSafeShellCommand(command: string): boolean {
  const segments = splitShellSequence(command);
  if (!segments || segments.length === 0) return false;
  return segments.every((seg) => SAFE_SEGMENT_PATTERNS.some((re) => re.test(seg)));
}

const shellExecTool = defineTool({
  name: "shell_exec",
  description:
    "Execute a shell command in a sandboxed subprocess. " +
    "Stdin is closed. Env is restricted to safe variables. " +
    "Returns stdout, stderr, exitCode, and timedOut flag.",
  riskLevel: "destructive",
  assessRisk(args) {
    const command = String(args.command ?? "").trim();
    return isSafeShellCommand(command) ? "safe" : "destructive";
  },
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "Shell command to run (passed to /bin/sh -c)",
      },
      cwd: {
        type: "string",
        description: "Working directory (must exist). Defaults to process cwd.",
      },
      timeout: {
        type: "number",
        description: `Timeout in seconds (default: ${DEFAULT_TIMEOUT_MS / 1000}, max: ${MAX_TIMEOUT_MS / 1000})`,
      },
    },
    required: ["command"],
  },
  async execute(ctx, args) {
    const command = String(args.command ?? "").trim();
    if (!command) return { error: "command is required" };

    const timeoutSec = Number(args.timeout ?? DEFAULT_TIMEOUT_MS / 1000);
    const timeoutMs = Math.min(timeoutSec * 1000, MAX_TIMEOUT_MS);
    const cwd = args.cwd ? String(args.cwd) : undefined;

    const cfg = ctx.config as YggdrasilConfig | undefined;
    const allowedRoot = (cfg?.pluginConfig?.["tool-shell"] as { allowedRoot?: string } | undefined);

    const result = await runShellInSandbox(command, {
      cwd: cwd ?? ctx.workspaceRoot,
      timeout: timeoutMs,
      allowedCwdRoot: allowedRoot?.allowedRoot,
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
    };
  },
});

const plugin = definePlugin({
  id: "tool-shell",
  name: "Shell Execution",
  version: "0.1.0",
  register(api) {
    api.registerTool(shellExecTool);
  },
});

export default plugin;
