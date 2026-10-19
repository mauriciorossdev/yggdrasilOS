import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type SettingsFile = { statusLine?: { type?: string; command?: string }; [key: string]: unknown };

// Matched against an existing statusLine.command to tell "ours" apart from
// one the user (or another tool) configured by hand.
const BRIDGE_MARKER = "statuslineBridge.js";

async function readExisting(path: string): Promise<SettingsFile> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as SettingsFile;
  } catch {
    return {};
  }
}

/**
 * Upserts a `statusLine` command into the project's `.claude/settings.local.json`
 * — Claude Code's machine-local, git-ignored-by-default settings file. This
 * is deliberately NOT `.claude/settings.json` (the shared, commit-worthy
 * file `writePaneControlMcpConfig` uses for `.mcp.json`): the bridge's
 * embedded control URL/token are only valid for this app process on this
 * machine, so they must never end up somewhere a team would commit and share.
 *
 * Every `claude` CLI session with this project as cwd then pipes its
 * rate_limits (Claude.ai Pro/Max session + weekly usage) to
 * statuslineBridge.ts on every status tick — see that file and
 * paneControlServer.ts's /statusline route.
 *
 * Refreshes the command on every project open (paneControlServer.ts mints a
 * fresh URL/token per app run — same reasoning as writePaneControlMcpConfig).
 * Never overwrites a `statusLine` some other tool or the user configured by
 * hand: detected by checking the existing command string for our own bridge
 * script's name; if it doesn't match, this project's usage tracking is
 * silently skipped rather than clobbering their setup. Returns whether the
 * config is (now) ours to manage.
 */
export async function writeStatuslineConfig(
  projectPath: string,
  bridgePath: string,
  controlUrl: string,
  controlToken: string,
): Promise<boolean> {
  const dir = join(projectPath, ".claude");
  const path = join(dir, "settings.local.json");
  const existing = await readExisting(path);

  if (existing.statusLine && !existing.statusLine.command?.includes(BRIDGE_MARKER)) {
    return false;
  }

  const merged: SettingsFile = {
    ...existing,
    statusLine: {
      type: "command",
      command: `node ${JSON.stringify(bridgePath)} ${JSON.stringify(controlUrl)} ${JSON.stringify(controlToken)}`,
    },
  };
  await mkdir(dir, { recursive: true });
  await writeFile(path, JSON.stringify(merged, null, 2), "utf8");
  return true;
}
