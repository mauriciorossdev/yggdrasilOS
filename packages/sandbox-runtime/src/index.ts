import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { existsSync, statSync } from "node:fs";

export type SandboxOptions = {
  command: string;
  args?: string[];
  cwd?: string;
  timeout?: number;     // ms, default 30_000
  maxBuffer?: number;   // bytes, default 1MB
  env?: Record<string, string>;
  allowedCwdRoot?: string; // if set, cwd must be under this path
};

export type SandboxResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
};

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_MAX_BUFFER = 1_024 * 1_024; // 1 MB

const ALLOWED_ENV_KEYS = new Set([
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TERM",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "PATH",
  "TMPDIR",
  "TMP",
  "TEMP",
]);

function buildEnv(extra: Record<string, string> = {}): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const key of ALLOWED_ENV_KEYS) {
    if (process.env[key] !== undefined) {
      filtered[key] = process.env[key]!;
    }
  }
  return { ...filtered, ...extra };
}

function resolveCwd(cwd?: string, allowedRoot?: string): string {
  const resolved = cwd ? resolve(cwd) : process.cwd();

  if (allowedRoot) {
    const root = resolve(allowedRoot);
    if (!resolved.startsWith(root + "/") && resolved !== root) {
      throw new Error(`cwd "${resolved}" is outside allowed root "${root}"`);
    }
  }

  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error(`cwd "${resolved}" does not exist or is not a directory`);
  }

  return resolved;
}

export async function runInSandbox(options: SandboxOptions): Promise<SandboxResult> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
  const cwd = resolveCwd(options.cwd, options.allowedCwdRoot);
  const env = buildEnv(options.env);

  const args = options.args ?? [];

  return new Promise<SandboxResult>((resolve) => {
    const child = spawn(options.command, args, {
      cwd,
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeout);

    child.stdout.on("data", (chunk: Buffer) => {
      const remaining = maxBuffer - Buffer.byteLength(stdout);
      if (remaining > 0) {
        stdout += chunk.slice(0, remaining).toString("utf8");
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const remaining = maxBuffer - Buffer.byteLength(stderr);
      if (remaining > 0) {
        stderr += chunk.slice(0, remaining).toString("utf8");
      }
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code, timedOut });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: err.message, exitCode: null, timedOut: false });
    });
  });
}

export async function runShellInSandbox(
  shellCommand: string,
  options: Omit<SandboxOptions, "command" | "args">,
): Promise<SandboxResult> {
  const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
  const args = process.platform === "win32" ? ["/c", shellCommand] : ["-c", shellCommand];
  return runInSandbox({ ...options, command: shell, args });
}
