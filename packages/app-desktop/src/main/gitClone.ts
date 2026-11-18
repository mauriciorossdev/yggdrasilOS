import { spawn } from "node:child_process";

/**
 * Cloning a git repo into a new project folder (Home → "Clone repository").
 * Pure parsing/validation lives here so it can be tested without Electron;
 * main/index.ts wires it to IPC, registers the clone and opens it.
 */

export type GitCloneErrorCode =
  | "emptyUrl"
  | "invalidUrl"
  | "unsupportedProtocol"
  | "invalidFolder"
  | "targetExists"
  | "gitMissing"
  | "timeout"
  | "cloneFailed";

/** Thrown with a stable code so the IPC handler can show a localized message. */
export class GitCloneError extends Error {
  constructor(
    readonly code: GitCloneErrorCode,
    readonly detail = "",
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "GitCloneError";
  }
}

export type ParsedGitUrl = {
  /** What gets passed to `git clone` (shorthand expanded, whitespace trimmed). */
  url: string;
  host: string;
  /** Last path segment without `.git` — the suggested folder name. */
  defaultFolder: string;
  /** HTTPS on github.com: the stored GitHub token can authenticate it (private repos). */
  githubHttps: boolean;
};

const ALLOWED_PROTOCOLS = new Set(["https:", "http:", "ssh:", "git:"]);
// owner/name. GitHub logins can't contain dots, so "gitlab.com/x" is never read as shorthand.
const GITHUB_SHORTHAND = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
// scp-like syntax: [user@]host:path — e.g. git@github.com:owner/repo.git
const SCP_LIKE = /^(?:([A-Za-z0-9._~-]+)@)?([A-Za-z0-9.-]+):(?!\/\/)(.+)$/;

function folderFromPath(path: string): string {
  const segments = path.split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? "";
  return last.replace(/\.git$/i, "");
}

/**
 * Accepts https/http/ssh/git URLs, scp-like `git@host:owner/repo`, and the
 * `owner/repo` shorthand (→ GitHub over HTTPS). Rejects anything git could
 * read as an option or a local/transport-helper path (`-…`, `file://`,
 * `ext::…`, `C:\…`), so a pasted string can only ever mean a remote repo.
 */
export function parseGitUrl(raw: string): ParsedGitUrl {
  const input = raw.trim();
  if (!input) throw new GitCloneError("emptyUrl");
  if (/\s/.test(input) || input.startsWith("-") || input.includes("::")) throw new GitCloneError("invalidUrl", input);

  if (GITHUB_SHORTHAND.test(input) && !input.includes(":")) {
    const url = `https://github.com/${input.replace(/\.git$/i, "")}.git`;
    return { url, host: "github.com", defaultFolder: folderFromPath(input), githubHttps: true };
  }

  // "github.com/owner/repo" copied from the address bar without the scheme.
  const withScheme = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\/[^/]/.test(input) ? `https://${input}` : input;

  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(withScheme)) {
    let parsed: URL;
    try {
      parsed = new URL(withScheme);
    } catch {
      throw new GitCloneError("invalidUrl", input);
    }
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) throw new GitCloneError("unsupportedProtocol", parsed.protocol.replace(/:$/, ""));
    if (!parsed.hostname) throw new GitCloneError("invalidUrl", input);
    const defaultFolder = folderFromPath(decodeURIComponent(parsed.pathname));
    if (!defaultFolder) throw new GitCloneError("invalidUrl", input);
    const host = parsed.hostname.toLowerCase();
    return {
      url: withScheme,
      host,
      defaultFolder,
      githubHttps: parsed.protocol === "https:" && (host === "github.com" || host === "www.github.com"),
    };
  }

  const scp = SCP_LIKE.exec(input);
  // A one-letter "host" is a Windows drive (C:\repo or C:/repo), i.e. a local path.
  if (scp && scp[2]!.length > 1) {
    const defaultFolder = folderFromPath(scp[3]!);
    if (!defaultFolder) throw new GitCloneError("invalidUrl", input);
    return { url: input, host: scp[2]!.toLowerCase(), defaultFolder, githubHttps: false };
  }

  throw new GitCloneError("invalidUrl", input);
}

/** One plain folder name for the clone — no separators, no dot tricks, no reserved characters. */
export function validateCloneFolderName(raw: string): string {
  const name = raw.trim();
  if (
    !name ||
    name.length > 100 ||
    name === "." ||
    name === ".." ||
    /[\\/:*?"<>|\u0000-\u001f]/.test(name) ||
    name.startsWith("-") ||
    name.endsWith(".") ||
    name.endsWith(" ")
  ) {
    throw new GitCloneError("invalidFolder", name);
  }
  return name;
}

const CLONE_TIMEOUT_MS = 10 * 60_000;

/**
 * Runs `git clone -- <url> <target>` non-interactively. With `githubToken` and
 * a github.com HTTPS URL, the token goes as an Authorization header through
 * GIT_CONFIG_* env vars (same approach as tool-github): never in the URL —
 * it'd be saved in .git/config — and never in argv. git removes `target`
 * itself when the clone fails.
 */
export async function cloneGitRepo(params: {
  url: ParsedGitUrl;
  target: string;
  githubToken?: string | null;
  timeoutMs?: number;
}): Promise<void> {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  // No ssh passphrase/host-key prompt to answer from a GUI: fail instead of hanging.
  if (!env.GIT_SSH_COMMAND) env.GIT_SSH_COMMAND = "ssh -o BatchMode=yes";
  let secret: string | null = null;
  if (params.githubToken && params.url.githubHttps) {
    secret = Buffer.from(`x-access-token:${params.githubToken}`).toString("base64");
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = "http.https://github.com/.extraheader";
    env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${secret}`;
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn("git", ["clone", "--", params.url.url, params.target], {
      stdio: ["ignore", "ignore", "pipe"],
      env,
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new GitCloneError("timeout"));
    }, params.timeoutMs ?? CLONE_TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new GitCloneError("gitMissing", err.message));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      const masked = secret ? stderr.replaceAll(secret, "***") : stderr;
      reject(new GitCloneError("cloneFailed", masked.trim().slice(-500)));
    });
  });
}
