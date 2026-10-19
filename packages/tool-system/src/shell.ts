import { defineTool } from "@yggdrasil/tools-sdk";
import { execAsync, EXEC_OPTS } from "./exec.js";

const MAX_OUTPUT = 20_000;

function truncate(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_OUTPUT) return { text, truncated: false };
  return { text: text.slice(0, MAX_OUTPUT), truncated: true };
}

export const runCommandTool = defineTool({
  name: "run_command",
  description: "Executes a shell command on this machine and returns stdout/stderr. Requires user approval.",
  riskLevel: "destructive",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "Shell command to execute" },
      cwd: { type: "string", description: "Working directory (default: current directory)" },
    },
    required: ["command"],
  },
  async execute(_ctx, args) {
    const command = String(args.command ?? "");
    const cwd = args.cwd ? String(args.cwd) : undefined;
    try {
      const { stdout, stderr } = await execAsync(command, { ...EXEC_OPTS, cwd });
      const out = truncate(stdout);
      const err = truncate(stderr);
      return {
        command,
        stdout: out.text,
        stdoutTruncated: out.truncated,
        stderr: err.text,
        stderrTruncated: err.truncated,
        exitCode: 0,
      };
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; code?: number; message: string };
      return {
        command,
        stdout: truncate(err.stdout ?? "").text,
        stderr: truncate(err.stderr ?? err.message).text,
        exitCode: err.code ?? 1,
      };
    }
  },
});
