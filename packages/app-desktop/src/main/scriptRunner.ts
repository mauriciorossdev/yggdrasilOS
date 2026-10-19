import { spawn, type ChildProcess } from "node:child_process";
import { writeFile, mkdtemp, chmod } from "node:fs/promises";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";

/**
 * Opens a NEW, real OS terminal window running `<packageManager> run
 * <scriptName>` in `cwd` — deliberately not one of this app's own node-pty/
 * xterm.js panes (terminals.ts). Same "hand off to a real OS-level app"
 * posture as tool-system/open-path.ts's Finder/Explorer opener (spawn
 * detached, `stdio: "ignore"`, `unref()`), but unlike that fire-and-forget
 * opener this actually waits for the child's "spawn" event before resolving
 * — worth doing here because the most likely failure (Linux: no
 * x-terminal-emulator on this distro) is common enough to surface to the
 * user rather than silently no-op.
 *
 * `packageManager`/`scriptName` are never free-typed user input — they come
 * from a project's own already-parsed package.json keys and this app's own
 * lockfile-based detection (ScriptsSection.tsx), the same trust level as the
 * user running that command by hand in that project.
 */
export async function runScriptInSystemTerminal(
  cwd: string,
  packageManager: string,
  scriptName: string,
): Promise<void> {
  const command = `${packageManager} run ${scriptName}`;
  const child = await spawnTerminal(cwd, command);
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", () => resolve());
    child.once("error", reject);
  });
  child.unref();
}

async function spawnTerminal(cwd: string, command: string): Promise<ChildProcess> {
  if (platform() === "darwin") {
    // A `.command` file is the simplest robust way to get Terminal.app to
    // actually *run* something (not just open at a folder, which `open -a
    // Terminal <cwd>` alone would do) — avoids the fragile double-escaping
    // of embedding a shell command inside an `osascript` string.
    const dir = await mkdtemp(join(tmpdir(), "ygg-script-"));
    const scriptPath = join(dir, "run.command");
    await writeFile(scriptPath, `#!/bin/bash\ncd ${shellQuote(cwd)}\n${command}\nexec $SHELL\n`, "utf8");
    await chmod(scriptPath, 0o755);
    return spawn("open", [scriptPath], { detached: true, stdio: "ignore" });
  }

  if (platform() === "win32") {
    return spawn("cmd.exe", ["/c", "start", "", "cmd", "/k", `cd /d "${cwd}" && ${command}`], {
      detached: true,
      stdio: "ignore",
      windowsVerbatimArguments: true,
    });
  }

  // Debian/Ubuntu convention — not guaranteed on every distro (Fedora has no
  // x-terminal-emulator alias). Accepted gap for v1, same tone as other
  // documented platform gaps in this app (see terminals.ts's Windows-
  // specific comments) — the caller sees this as a rejected promise rather
  // than a silent no-op.
  return spawn("x-terminal-emulator", ["-e", "bash", "-c", `cd ${shellQuote(cwd)} && ${command}; exec bash`], {
    detached: true,
    stdio: "ignore",
  });
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
