import { execFileSync } from "node:child_process";

const DELIM = "___YGGDRASIL_PATH___";

/**
 * An Electron app launched from Finder/Dock (not from a terminal) inherits
 * macOS's minimal LaunchServices PATH — it never sources ~/.zshrc/.zprofile,
 * so anything installed via nvm, Homebrew, or a `~/.local/bin` installer
 * (node, claude, agy, ...) is invisible to it. `node-pty`'s spawn execs the
 * target binary directly with no shell in between (see terminals.ts), so
 * without this fix any Agent Flow harness whose CLI lives outside the OS
 * default PATH fails immediately (execvp ENOENT) with no pty output at all —
 * the "[process exited (code 1)]" symptom, and nothing to explain it. The
 * plain Terminal tab doesn't need this: that pty runs a real login shell,
 * which sources its own profile independently of this process's env.
 *
 * `-ilc` runs an interactive login shell so profile files that only fire for
 * those actually get sourced; some setups print banners/noise on top of that,
 * so the PATH is wrapped in a unique delimiter and pulled out with a regex
 * rather than assumed to be the only or last line of output.
 */
export function resolveShellPath(): string {
  if (process.platform === "win32") return process.env.PATH ?? "";

  const shell = process.env.SHELL || "/bin/zsh";
  try {
    const output = execFileSync(shell, ["-ilc", `echo ${DELIM}\${PATH}${DELIM}`], {
      encoding: "utf8",
      timeout: 5000,
    });
    const match = output.match(new RegExp(`${DELIM}(.*?)${DELIM}`));
    return match?.[1] || process.env.PATH || "";
  } catch {
    return process.env.PATH ?? "";
  }
}
