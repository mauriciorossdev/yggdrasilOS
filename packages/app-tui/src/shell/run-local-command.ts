import { execFile } from "node:child_process";

export type LocalCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
};

export type ShellInvocation = {
  file: string;
  args: string[];
};

const TIMEOUT_MS = 30_000;
const MAX_BUFFER = 10 * 1024 * 1024;
const MAX_OUTPUT_CHARS = 20_000;

export function resolveShellInvocation(platform: NodeJS.Platform, command: string): ShellInvocation {
  if (platform === "win32") {
    return { file: "powershell.exe", args: ["-NoProfile", "-Command", command] };
  }
  return { file: process.env.SHELL || "/bin/sh", args: ["-c", command] };
}

function truncate(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n... (truncated, ${text.length - MAX_OUTPUT_CHARS} more chars)`;
}

export async function runLocalCommand(command: string, cwd: string): Promise<LocalCommandResult> {
  const { file, args } = resolveShellInvocation(process.platform, command);

  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { cwd, timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout: truncate(stdout), stderr: truncate(stderr), exitCode: 0, timedOut: false });
          return;
        }

        const execError = error as NodeJS.ErrnoException & {
          code?: number | string;
          killed?: boolean;
          signal?: string;
          stdout?: string;
          stderr?: string;
        };

        resolve({
          stdout: truncate(execError.stdout ?? stdout),
          stderr: truncate(execError.stderr ?? stderr ?? execError.message),
          exitCode: typeof execError.code === "number" ? execError.code : null,
          timedOut: !!execError.killed && execError.signal === "SIGTERM",
        });
      },
    );
  });
}
