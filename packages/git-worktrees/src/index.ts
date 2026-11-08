import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

// Creating a worktree the way this app does it, shared by the gateway
// (git.worktreeAdd, from the Worktrees tab) and the desktop's main process
// (create_pane's `worktree` option), so both enforce the same rules.

/** Where the app keeps the worktrees it creates, relative to the repo's own checkout. */
export const APP_WORKTREES_DIR = ".yggdrasil/worktrees";

/** Branch prefix of the worktrees the app creates (ygg/<name>). */
export const APP_BRANCH_PREFIX = "ygg/";

type GitResult = { stdout: string; stderr: string; code: number };

function git(cwd: string, args: string[]): Promise<GitResult> {
  return new Promise((done) => {
    execFile(
      "git",
      args,
      {
        cwd,
        maxBuffer: 20 * 1024 * 1024,
        timeout: 60_000,
        // Never block on a credential prompt nobody can answer.
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "echo" },
      },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
        done({ stdout, stderr, code });
      },
    );
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** A worktree name becomes a folder and a branch: keep it to a plain, portable slug. */
export function validateWorktreeName(name: unknown, who = "worktree"): string {
  const value = String(name ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value) || value.includes("..") || value.endsWith(".lock")) {
    throw new Error(`${who}: invalid worktree name (letters, digits, '.', '_' and '-'; up to 64; must start with a letter or digit)`);
  }
  return value;
}

/** Turns free text (a pane title, say) into a valid worktree name, or "" when nothing usable is left. */
export function slugifyWorktreeName(text: string): string {
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
    .replace(/\.{2,}/g, ".")
    .slice(0, 48);
  return slug.endsWith(".lock") ? slug.slice(0, -5) : slug;
}

/** The toplevel of the repository containing `dir`, or null when it is not in one. */
export async function repoToplevel(dir: string): Promise<string | null> {
  const res = await git(dir, ["rev-parse", "--show-toplevel"]);
  return res.code === 0 ? resolve(res.stdout.trim()) : null;
}

export type CreatedWorktree = { path: string; branch: string; base: string | null };

/**
 * Creates <repo>/.yggdrasil/worktrees/<name> on a new branch ygg/<name> (from
 * `base`, or the repo's HEAD). The folder is kept out of the main checkout's
 * status through the repo's own info/exclude, so no tracked file changes.
 */
export async function createAppWorktree(
  repo: string,
  opts: { name: string; base?: string },
  who = "worktree",
): Promise<CreatedWorktree> {
  const name = validateWorktreeName(opts.name, who);
  const base = opts.base?.trim() || undefined;
  if (base && (base.startsWith("-") || /[\0\n\r]/.test(base))) throw new Error(`${who}: invalid base`);
  const branch = `${APP_BRANCH_PREFIX}${name}`;
  const path = join(repo, APP_WORKTREES_DIR, name);

  if (await exists(path)) throw new Error(`${who}: ${APP_WORKTREES_DIR}/${name} already exists`);
  if (await exists(join(repo, ".claude", "worktrees", name))) {
    throw new Error(`${who}: the name "${name}" is already used by a Claude worktree`);
  }
  const taken = await git(repo, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
  if (taken.code === 0) throw new Error(`${who}: branch ${branch} already exists`);

  const excludeRes = await git(repo, ["rev-parse", "--git-path", "info/exclude"]);
  if (excludeRes.code !== 0) throw new Error(`${who}: ${(excludeRes.stderr || "git rev-parse failed").trim()}`);
  const excludePath = resolve(repo, excludeRes.stdout.trim());
  const entry = `${APP_WORKTREES_DIR}/`;
  const current = await readFile(excludePath, "utf8").catch(() => "");
  if (!current.split("\n").some((line) => line.trim() === entry)) {
    await mkdir(resolve(excludePath, ".."), { recursive: true });
    await appendFile(excludePath, `${current === "" || current.endsWith("\n") ? "" : "\n"}${entry}\n`);
  }

  await mkdir(resolve(path, ".."), { recursive: true });
  const res = await git(repo, ["worktree", "add", "-b", branch, path, ...(base ? [base] : [])]);
  if (res.code !== 0) throw new Error(`${who}: ${(res.stderr || res.stdout || "git worktree add failed").trim()}`);
  return { path, branch, base: base ?? null };
}
