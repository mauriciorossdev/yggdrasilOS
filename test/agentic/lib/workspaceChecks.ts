import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Check, CheckResult } from "./types.js";

export type CommandResult = { code: number; stdout: string; stderr: string; timedOut: boolean };

/** Runs a command the way the grader does (not the model): real exit codes, bounded time. */
export function runIn(cwd: string, command: string, timeoutMs = 120_000, env: NodeJS.ProcessEnv = {}): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile("/bin/sh", ["-c", command], { cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, CI: "1", ...env } }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string }) | null;
      resolve({
        code: e ? (typeof e.code === "number" ? e.code : 1) : 0,
        stdout: String(stdout),
        stderr: String(stderr),
        timedOut: Boolean(e?.killed),
      });
    });
  });
}

export const exists = (path: string) => access(path).then(() => true, () => false);

export async function sha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

export async function listFiles(dir: string, skip = new Set(["node_modules", ".git", "dist", ".yggdrasil"])): Promise<string[]> {
  const out: string[] = [];
  const walk = async (d: string, prefix: string) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(join(d, e.name), rel);
      else out.push(rel);
    }
  };
  await walk(dir, "");
  return out.sort();
}

const tail = (s: string, n = 600) => (s.length > n ? `…${s.slice(-n)}` : s).trim();

/** The check "this command exits 0", with the output as the failure detail. */
export function commandPasses(id: string, description: string, command: string, opts: { must?: boolean; weight?: number; timeoutMs?: number } = {}): Check {
  return {
    id,
    description,
    must: opts.must,
    weight: opts.weight,
    async run({ workspace }): Promise<CheckResult> {
      const r = await runIn(workspace, command, opts.timeoutMs);
      return r.code === 0 ? { pass: true } : { pass: false, detail: `${command} → exit ${r.code}${r.timedOut ? " (timed out)" : ""}\n${tail(r.stderr || r.stdout)}` };
    },
  };
}

export function fileExists(id: string, rel: string, opts: { must?: boolean } = {}): Check {
  return {
    id,
    description: `${rel} exists`,
    must: opts.must,
    async run({ workspace }) {
      return (await exists(join(workspace, rel))) ? { pass: true } : { pass: false, detail: `${rel} not found` };
    },
  };
}

// Hashes taken in a scenario's setup, so a check can tell whether the model touched a file it was told to leave alone.
const snapshots = new Map<string, string>();
const snapKey = (workspace: string, rel: string) => `${workspace}::${rel}`;

export async function snapshotFile(workspace: string, rel: string): Promise<void> {
  snapshots.set(snapKey(workspace, rel), await sha256(join(workspace, rel)));
}

/** A file that must not change (a test the model is told not to edit). Needs snapshotFile() in setup. */
export function fileUnchanged(id: string, rel: string): Check {
  return {
    id,
    description: `${rel} was not modified`,
    must: true,
    async run({ workspace }) {
      const before = snapshots.get(snapKey(workspace, rel));
      if (!before) return { pass: false, detail: `no snapshot of ${rel} (scenario setup bug)` };
      try {
        return (await sha256(join(workspace, rel))) === before ? { pass: true } : { pass: false, detail: `${rel} changed` };
      } catch {
        return { pass: false, detail: `${rel} is gone` };
      }
    },
  };
}

/** Path of the repo's own TypeScript compiler, so graded workspaces need no node_modules. */
export const TSC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "node_modules", "typescript", "bin", "tsc");

export function usedTool(id: string, names: string[], description: string): Check {
  return {
    id,
    description,
    run: ({ toolCalls }) => {
      const hit = toolCalls.some((c) => names.includes(c.name));
      return hit ? { pass: true } : { pass: false, detail: `none of ${names.join(", ")} was called (used: ${[...new Set(toolCalls.map((c) => c.name))].join(", ") || "no tools"})` };
    },
  };
}

export function repliedWith(id: string, pattern: RegExp, description: string, opts: { must?: boolean } = {}): Check {
  return {
    id,
    description,
    must: opts.must,
    run: ({ replies }) => (pattern.test(replies) ? { pass: true } : { pass: false, detail: `reply did not match ${pattern}: ${tail(replies, 300)}` }),
  };
}

/** The model changed things by running its own commands, not just by editing (e.g. it ran the tests). */
export function ranCommand(id: string, pattern: RegExp, description: string): Check {
  return {
    id,
    description,
    run: ({ toolCalls }) => {
      const cmds = toolCalls
        .filter((c) => ["run_command", "shell_exec"].includes(c.name))
        .map((c) => String(c.args.command ?? c.args.cmd ?? ""));
      return cmds.some((c) => pattern.test(c)) ? { pass: true } : { pass: false, detail: `no command matched ${pattern} (ran: ${cmds.join(" | ") || "none"})` };
    },
  };
}
