import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { findOnPath } from "./ideSettings.js";

const execFileAsync = promisify(execFile);

/** Ids match AgentFlowHarness["type"] in the renderer (minus "yggdrasil", which needs no external CLI). */
export type CliId = "claude" | "antigravity" | "omp" | "copilot";

export type CliCatalogEntry = {
  id: CliId;
  label: string;
  /** PATH binary — same names buildLaunchCommand.ts spawns. */
  command: string;
  installUrl?: string;
};

export const CLI_CATALOG: CliCatalogEntry[] = [
  { id: "claude", label: "Claude Code", command: "claude", installUrl: "https://docs.claude.com/en/docs/claude-code/overview" },
  { id: "copilot", label: "GitHub Copilot CLI", command: "copilot", installUrl: "https://github.com/github/copilot-cli" },
  { id: "antigravity", label: "Antigravity (agy)", command: "agy", installUrl: "https://antigravity.google" },
  { id: "omp", label: "omp", command: "omp" },
];

export type DetectedCli = {
  id: CliId;
  label: string;
  command: string;
  installUrl?: string;
  installed: boolean;
  version?: string;
  path?: string;
};

/** First dotted version number in a `--version` output ("claude 2.1.4 (Claude Code)" → "2.1.4"). */
export function parseVersion(output: string): string | undefined {
  const match = output.match(/\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?/);
  return match?.[0];
}

export type CliDetectDeps = {
  locate: (command: string) => Promise<string | null>;
  /** Returns the stdout of `<path> --version`, or null if it can't be run. */
  runVersion: (path: string) => Promise<string | null>;
};

async function runVersion(path: string): Promise<string | null> {
  // Same Windows constraint as ideSettings.launchDetached: .cmd/.bat shims
  // can't be spawned directly since the CVE-2024-27980 fix.
  const needsShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(path);
  try {
    const { stdout } = await execFileAsync(needsShell ? `"${path}"` : path, ["--version"], {
      timeout: 3000,
      windowsHide: true,
      shell: needsShell,
    });
    return stdout;
  } catch {
    return null;
  }
}

const defaultDeps: CliDetectDeps = { locate: findOnPath, runVersion };

/** Finds each catalog CLI on PATH. Found-but-unrunnable still counts as installed, just without a version. */
export async function detectClis(deps: CliDetectDeps = defaultDeps): Promise<DetectedCli[]> {
  return Promise.all(
    CLI_CATALOG.map(async (entry): Promise<DetectedCli> => {
      const base = { id: entry.id, label: entry.label, command: entry.command, installUrl: entry.installUrl };
      const path = await deps.locate(entry.command);
      if (!path) return { ...base, installed: false };
      const out = await deps.runVersion(path);
      const version = out ? parseVersion(out) : undefined;
      return { ...base, installed: true, path, ...(version ? { version } : {}) };
    }),
  );
}
