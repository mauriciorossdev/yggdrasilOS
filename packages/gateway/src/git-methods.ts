import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { GatewayMethodHandler } from "./methods.js";

// Repository tab (RepositoryView.tsx) backend. Unlike git.status/git.diff
// (sidebar list in methods.ts), these methods are a direct user action from
// the app UI: a click is the authorization, so there is no approval round
// trip — instead they are limited to loopback / trusted-device connections
// and are never exposed to the agent as tools. Every method takes `repo`
// (relative to workspaceRoot, "." by default) and never an arbitrary cwd.

export interface GitMethodsDeps {
  register(name: string, handler: GatewayMethodHandler): void;
  isLoopbackConnection(connectionId: string | undefined): boolean;
  isTrustedDeviceConnection(workspaceRoot: string | undefined, connectionId: string | undefined): Promise<boolean>;
}

type GitResult = { stdout: string; stderr: string; code: number };

const MAX_BUFFER = 20 * 1024 * 1024;
const LOCAL_TIMEOUT_MS = 60_000;
const REMOTE_TIMEOUT_MS = 120_000;
const MAX_DIFF_CHARS = 2_000_000;

const SCAN_MAX_DEPTH = 3;
const SCAN_MAX_REPOS = 50;
const SCAN_SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".expo",
  ".turbo",
  ".cache",
  "coverage",
  "target",
  "vendor",
  "Pods",
  ".venv",
  "venv",
  "__pycache__",
]);

export function execGitRaw(
  cwd: string,
  args: string[],
  opts: { timeoutMs?: number; readOnly?: boolean } = {},
): Promise<GitResult> {
  return new Promise((resolvePromise) => {
    execFile(
      "git",
      args,
      {
        cwd,
        maxBuffer: MAX_BUFFER,
        timeout: opts.timeoutMs ?? LOCAL_TIMEOUT_MS,
        env: {
          ...process.env,
          // Never block on a credential/passphrase prompt nobody can answer.
          GIT_TERMINAL_PROMPT: "0",
          GIT_ASKPASS: "echo",
          // Pure reads must not take index.lock and fight the user's own git.
          ...(opts.readOnly ? { GIT_OPTIONAL_LOCKS: "0" } : {}),
        },
      },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
        resolvePromise({ stdout, stderr: error && error.killed ? `${stderr}\ngit timed out` : stderr, code });
      },
    );
  });
}

function fail(method: string, res: GitResult, fallback: string): never {
  throw new Error(`${method}: ${(res.stderr || res.stdout || fallback).trim()}`);
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

function assertRef(method: string, ref: unknown, label = "ref"): string {
  const value = String(ref ?? "");
  if (!value || value.startsWith("-") || /[\0\n\r]/.test(value)) throw new Error(`${method}: invalid ${label}`);
  return value;
}

function assertPaths(method: string, paths: unknown): string[] {
  if (!Array.isArray(paths) || paths.length === 0) throw new Error(`${method}: paths is required`);
  return paths.map((p) => {
    const value = String(p);
    if (!value || /\0/.test(value)) throw new Error(`${method}: invalid path`);
    return value;
  });
}

function assertStashIndex(method: string, index: unknown): string {
  const n = Number(index);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${method}: invalid stash index`);
  return `stash@{${n}}`;
}

// ---------- porcelain parsers (exported for tests) ----------

export type GitChange = {
  path: string;
  origPath?: string;
  /** Index (staged) status letter, "." when unchanged. */
  index: string;
  /** Worktree (unstaged) status letter, "." when unchanged; "?" for untracked. */
  worktree: string;
  kind: "changed" | "renamed" | "unmerged" | "untracked";
};

export type GitStatus2 = {
  branch?: string;
  detached: boolean;
  upstream?: string;
  ahead: number;
  behind: number;
  changes: GitChange[];
  merging: boolean;
};

// `git status --porcelain=v2 -z --branch`: NUL-terminated records, so paths
// with spaces/quotes/unicode arrive verbatim (v1 quotes them).
export function parseStatusV2(output: string): GitStatus2 {
  const result: GitStatus2 = { detached: false, ahead: 0, behind: 0, changes: [], merging: false };
  const records = output.split("\0");
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (!rec) continue;
    if (rec.startsWith("# ")) {
      const [key, ...rest] = rec.slice(2).split(" ");
      const value = rest.join(" ");
      if (key === "branch.head") {
        if (value === "(detached)") result.detached = true;
        else result.branch = value;
      } else if (key === "branch.upstream") result.upstream = value;
      else if (key === "branch.ab") {
        const m = /^\+(\d+) -(\d+)$/.exec(value);
        if (m) {
          result.ahead = Number(m[1]);
          result.behind = Number(m[2]);
        }
      }
    } else if (rec[0] === "1") {
      // 1 XY sub mH mI mW hH hI path
      const parts = rec.split(" ");
      const xy = parts[1];
      result.changes.push({ path: parts.slice(8).join(" "), index: xy[0], worktree: xy[1], kind: "changed" });
    } else if (rec[0] === "2") {
      // 2 XY sub mH mI mW hH hI Xscore path \0 origPath
      const parts = rec.split(" ");
      const xy = parts[1];
      const origPath = records[++i] ?? "";
      result.changes.push({
        path: parts.slice(9).join(" "),
        origPath,
        index: xy[0],
        worktree: xy[1],
        kind: "renamed",
      });
    } else if (rec[0] === "u") {
      // u XY sub m1 m2 m3 mW h1 h2 h3 path
      const parts = rec.split(" ");
      const xy = parts[1];
      result.changes.push({ path: parts.slice(10).join(" "), index: xy[0], worktree: xy[1], kind: "unmerged" });
    } else if (rec[0] === "?") {
      result.changes.push({ path: rec.slice(2), index: ".", worktree: "?", kind: "untracked" });
    }
  }
  return result;
}

export type GitBranchInfo = {
  name: string;
  remote: boolean;
  current: boolean;
  upstream?: string;
  ahead: number;
  behind: number;
  sha: string;
  subject: string;
};

// for-each-ref understands %00; the log/show/stash pretty formats need %x00.
const FIELD = "%00";
const PRETTY_FIELD = "%x00";

export function parseBranches(output: string): GitBranchInfo[] {
  const branches: GitBranchInfo[] = [];
  for (const line of output.split("\n")) {
    if (!line) continue;
    const [refname, short, upstream, track, head, sha, subject] = line.split("\0");
    if (!refname) continue;
    const remote = refname.startsWith("refs/remotes/");
    // "origin/HEAD" (symbolic) is noise, not a branch.
    if (remote && (short.endsWith("/HEAD") || short === "origin")) continue;
    const ahead = /ahead (\d+)/.exec(track ?? "");
    const behind = /behind (\d+)/.exec(track ?? "");
    branches.push({
      name: short,
      remote,
      current: head === "*",
      upstream: upstream || undefined,
      ahead: ahead ? Number(ahead[1]) : 0,
      behind: behind ? Number(behind[1]) : 0,
      sha: sha ?? "",
      subject: subject ?? "",
    });
  }
  return branches;
}

export type GitCommit = {
  sha: string;
  short: string;
  author: string;
  email: string;
  date: string;
  parents: string[];
  refs: string[];
  subject: string;
};

export function parseLog(output: string): GitCommit[] {
  const commits: GitCommit[] = [];
  for (const rec of output.split("\x1e")) {
    const trimmed = rec.replace(/^\n/, "");
    if (!trimmed) continue;
    const [sha, short, author, email, date, parents, refs, subject] = trimmed.split("\0");
    if (!sha) continue;
    commits.push({
      sha,
      short,
      author,
      email,
      date,
      parents: parents ? parents.split(" ") : [],
      refs: refs ? refs.split(", ").filter(Boolean) : [],
      subject: subject ?? "",
    });
  }
  return commits;
}

export type GitCommitFile = { status: string; path: string; origPath?: string };

// `diff-tree --name-status -z`: "STATUS\0path\0" (renames/copies: "R100\0old\0new\0").
export function parseNameStatus(output: string): GitCommitFile[] {
  const parts = output.split("\0");
  const files: GitCommitFile[] = [];
  for (let i = 0; i < parts.length; i++) {
    const status = parts[i];
    if (!status) continue;
    if (status[0] === "R" || status[0] === "C") {
      files.push({ status: status[0], origPath: parts[i + 1], path: parts[i + 2] });
      i += 2;
    } else {
      files.push({ status: status[0], path: parts[i + 1] });
      i += 1;
    }
  }
  return files;
}

// ---------- registration ----------

export function registerGitMethods(deps: GitMethodsDeps): void {
  async function authorize(method: string, workspaceRoot: string | undefined, connectionId: string | undefined): Promise<string> {
    if (!workspaceRoot) throw new Error(`${method}: this gateway has no workspaceRoot`);
    if (!deps.isLoopbackConnection(connectionId) && !(await deps.isTrustedDeviceConnection(workspaceRoot, connectionId))) {
      throw new Error(`${method}: only available to the local app or a trusted device`);
    }
    return resolve(workspaceRoot);
  }

  // `repo` is relative to workspaceRoot. It may point inside the root (repo in
  // a subfolder) or be exactly the toplevel of the repo that *contains* the
  // root (project opened on a subfolder of a bigger repo) — nothing else.
  async function resolveRepo(method: string, root: string, repoParam: unknown): Promise<string> {
    const rel = String(repoParam ?? ".") || ".";
    const abs = resolve(root, rel);
    const relToRoot = relative(root, abs);
    const inside = !(relToRoot.startsWith("..") || isAbsolute(relToRoot));
    if (!inside) {
      const top = await execGitRaw(root, ["rev-parse", "--show-toplevel"], { readOnly: true });
      if (top.code !== 0 || resolve(top.stdout.trim()) !== abs) {
        throw new Error(`${method}: repo escapes the project root`);
      }
    }
    const check = await execGitRaw(abs, ["rev-parse", "--show-toplevel"], { readOnly: true });
    if (check.code !== 0) throw new Error(`${method}: not a git repository: ${rel}`);
    // Operate on the real toplevel so every returned path is repo-root-relative.
    return resolve(check.stdout.trim());
  }

  function define(
    name: string,
    fn: (params: Record<string, unknown>, repo: string) => Promise<unknown>,
  ): void {
    deps.register(name, async (params, ctx, connectionId) => {
      const root = await authorize(name, ctx.workspaceRoot, connectionId);
      const repo = await resolveRepo(name, root, params.repo);
      return fn(params, repo);
    });
  }

  // ----- discovery -----

  deps.register("git.repos", async (_params, ctx, connectionId) => {
    const root = await authorize("git.repos", ctx.workspaceRoot, connectionId);
    const repos: Array<{ path: string; name: string; branch?: string; relation: "root" | "parent" | "child" }> = [];

    async function branchOf(dir: string): Promise<string | undefined> {
      const res = await execGitRaw(dir, ["rev-parse", "--abbrev-ref", "HEAD"], { readOnly: true });
      if (res.code !== 0) {
        // Fresh repo with no commits: HEAD is unborn.
        const sym = await execGitRaw(dir, ["symbolic-ref", "--short", "HEAD"], { readOnly: true });
        return sym.code === 0 ? sym.stdout.trim() : undefined;
      }
      const name = res.stdout.trim();
      return name === "HEAD" ? "(detached)" : name;
    }

    const top = await execGitRaw(root, ["rev-parse", "--show-toplevel"], { readOnly: true });
    const topAbs = top.code === 0 ? resolve(top.stdout.trim()) : null;
    if (topAbs) {
      const rel = toPosix(relative(root, topAbs)) || ".";
      repos.push({
        path: rel,
        name: basename(topAbs),
        branch: await branchOf(topAbs),
        relation: rel === "." ? "root" : "parent",
      });
    }

    // Children: nested repos (monorepo wrapper / several repos in one project).
    // Stop descending at a repo — its own submodules/nesting aren't separate entries.
    async function scan(dir: string, depth: number): Promise<void> {
      if (depth > SCAN_MAX_DEPTH || repos.length >= SCAN_MAX_REPOS) return;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || SCAN_SKIP_DIRS.has(entry.name)) continue;
        const abs = join(dir, entry.name);
        let isRepo = false;
        try {
          await readFile(join(abs, ".git", "HEAD"), "utf8");
          isRepo = true;
        } catch {
          // .git may be a file (worktree/submodule) — treat that as a repo too.
          try {
            const gitFile = await readFile(join(abs, ".git"), "utf8");
            isRepo = gitFile.startsWith("gitdir:");
          } catch {
            isRepo = false;
          }
        }
        if (isRepo) {
          if (repos.length < SCAN_MAX_REPOS) {
            repos.push({
              path: toPosix(relative(root, abs)),
              name: entry.name,
              branch: await branchOf(abs),
              relation: "child",
            });
          }
        } else {
          await scan(abs, depth + 1);
        }
      }
    }
    // The root itself is only scanned for children when it is not a repo, or
    // even when it is (a repo can contain independent nested repos).
    await scan(root, 1);

    return { workspaceRoot: root, repos };
  });

  deps.register("git.init", async (params, ctx, connectionId) => {
    const root = await authorize("git.init", ctx.workspaceRoot, connectionId);
    const abs = resolve(root, String(params.path ?? "."));
    const rel = relative(root, abs);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("git.init: path escapes the project root");
    const res = await execGitRaw(abs, ["init"]);
    if (res.code !== 0) fail("git.init", res, "git init failed");
    return { ok: true };
  });

  // ----- reads -----

  define("git.status2", async (_params, repo) => {
    const res = await execGitRaw(repo, ["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"], {
      readOnly: true,
    });
    if (res.code !== 0) fail("git.status2", res, "git status failed");
    const status = parseStatusV2(res.stdout);
    const merge = await execGitRaw(repo, ["rev-parse", "-q", "--verify", "MERGE_HEAD"], { readOnly: true });
    status.merging = merge.code === 0;
    return status;
  });

  define("git.branches", async (_params, repo) => {
    const format = ["%(refname)", "%(refname:short)", "%(upstream:short)", "%(upstream:track,nobracket)", "%(HEAD)", "%(objectname:short)", "%(contents:subject)"].join(FIELD);
    const res = await execGitRaw(repo, ["for-each-ref", `--format=${format}`, "refs/heads", "refs/remotes"], {
      readOnly: true,
    });
    if (res.code !== 0) fail("git.branches", res, "git for-each-ref failed");
    return { branches: parseBranches(res.stdout) };
  });

  define("git.remotes", async (_params, repo) => {
    const res = await execGitRaw(repo, ["remote", "-v"], { readOnly: true });
    if (res.code !== 0) fail("git.remotes", res, "git remote failed");
    // "<name>\t<url> (fetch|push)" — one fetch line per remote is enough.
    const remotes: Array<{ name: string; url: string }> = [];
    for (const line of res.stdout.split("\n")) {
      const m = /^(\S+)\t(.+) \(fetch\)$/.exec(line);
      if (m) remotes.push({ name: m[1], url: m[2] });
    }
    return { remotes };
  });

  define("git.log", async (params, repo) => {
    const limit = Math.min(Math.max(Number(params.limit ?? 100) || 100, 1), 500);
    const skip = Math.max(Number(params.skip ?? 0) || 0, 0);
    const format = ["%H", "%h", "%an", "%ae", "%aI", "%P", "%D", "%s"].join(PRETTY_FIELD) + "%x1e";
    const args = ["log", `--max-count=${limit}`, `--skip=${skip}`, `--format=${format}`, "--decorate=short"];
    if (params.ref) args.push(assertRef("git.log", params.ref), "--");
    else args.push("--all");
    const res = await execGitRaw(repo, args, { readOnly: true });
    if (res.code !== 0) {
      // Repo with no commits yet.
      if (/does not have any commits|unknown revision|bad default revision/i.test(res.stderr)) {
        return { commits: [], hasMore: false };
      }
      fail("git.log", res, "git log failed");
    }
    const commits = parseLog(res.stdout);
    return { commits, hasMore: commits.length === limit };
  });

  define("git.show", async (params, repo) => {
    const sha = assertRef("git.show", params.sha, "sha");
    const files = await execGitRaw(repo, ["diff-tree", "--no-commit-id", "--name-status", "-r", "-z", "-M", "--root", sha], {
      readOnly: true,
    });
    if (files.code !== 0) fail("git.show", files, "git diff-tree failed");
    const meta = await execGitRaw(repo, ["show", "-s", `--format=%H${PRETTY_FIELD}%an${PRETTY_FIELD}%ae${PRETTY_FIELD}%aI${PRETTY_FIELD}%B`, sha], {
      readOnly: true,
    });
    if (meta.code !== 0) fail("git.show", meta, "git show failed");
    const [fullSha, author, email, date, ...body] = meta.stdout.split("\0");
    return {
      sha: fullSha,
      author,
      email,
      date,
      message: body.join("\0").trimEnd(),
      files: parseNameStatus(files.stdout),
    };
  });

  // Returns both sides' full text so the renderer's Monaco DiffEditor does the
  // diffing (side-by-side / inline) — no unified-diff parsing on our side.
  define("git.diff2", async (params, repo) => {
    const path = assertPaths("git.diff2", [params.path])[0];
    const mode = String(params.mode ?? "unstaged");

    async function blob(spec: string): Promise<string> {
      const res = await execGitRaw(repo, ["show", spec], { readOnly: true });
      return res.code === 0 ? res.stdout : "";
    }
    async function worktree(): Promise<string> {
      try {
        const abs = resolve(repo, path);
        const rel = relative(repo, abs);
        if (rel.startsWith("..") || isAbsolute(rel)) return "";
        return await readFile(abs, "utf8");
      } catch {
        return "";
      }
    }

    let original: string;
    let modified: string;
    if (mode === "staged") {
      original = await blob(`HEAD:${path}`);
      modified = await blob(`:${path}`);
    } else if (mode === "commit") {
      const sha = assertRef("git.diff2", params.sha, "sha");
      const prev = params.origPath ? String(params.origPath) : path;
      original = await blob(`${sha}^:${prev}`);
      modified = await blob(`${sha}:${path}`);
    } else if (mode === "unstaged") {
      original = await blob(`:${path}`);
      modified = await worktree();
    } else {
      throw new Error(`git.diff2: unknown mode "${mode}"`);
    }

    if (original.includes("\0") || modified.includes("\0")) return { binary: true, original: "", modified: "" };
    if (original.length > MAX_DIFF_CHARS || modified.length > MAX_DIFF_CHARS) {
      return { tooLarge: true, original: "", modified: "" };
    }
    return { original, modified };
  });

  // ----- local mutations -----

  define("git.checkout", async (params, repo) => {
    const branch = assertRef("git.checkout", params.branch, "branch");
    let args: string[];
    if (params.create === true) {
      const valid = await execGitRaw(repo, ["check-ref-format", "--branch", branch], { readOnly: true });
      if (valid.code !== 0) throw new Error(`git.checkout: invalid branch name "${branch}"`);
      args = ["switch", "-c", branch];
      if (params.startPoint) args.push(assertRef("git.checkout", params.startPoint, "startPoint"));
    } else if (params.remote === true) {
      // "origin/feat" → create local tracking branch "feat".
      args = ["switch", "--track", branch];
    } else {
      args = ["switch", branch];
    }
    // No --force/--discard-changes: git itself refuses when local changes
    // would be overwritten and its message is shown to the user as-is.
    const res = await execGitRaw(repo, args);
    if (res.code !== 0) fail("git.checkout", res, "git switch failed");
    return { ok: true };
  });

  define("git.checkoutCommit", async (params, repo) => {
    const sha = assertRef("git.checkoutCommit", params.sha, "sha");
    const res = await execGitRaw(repo, ["switch", "--detach", sha]);
    if (res.code !== 0) fail("git.checkoutCommit", res, "git switch --detach failed");
    return { ok: true };
  });

  define("git.branchDelete", async (params, repo) => {
    const branch = assertRef("git.branchDelete", params.branch, "branch");
    const res = await execGitRaw(repo, ["branch", params.force === true ? "-D" : "-d", "--", branch]);
    if (res.code !== 0) fail("git.branchDelete", res, "git branch -d failed");
    return { ok: true };
  });

  define("git.stage", async (params, repo) => {
    const args = params.all === true ? ["add", "-A"] : ["add", "--", ...assertPaths("git.stage", params.paths)];
    const res = await execGitRaw(repo, args);
    if (res.code !== 0) fail("git.stage", res, "git add failed");
    return { ok: true };
  });

  define("git.unstage", async (params, repo) => {
    const paths = params.all === true ? ["."] : assertPaths("git.unstage", params.paths);
    let res = await execGitRaw(repo, ["restore", "--staged", "--", ...paths]);
    if (res.code !== 0) {
      // No commits yet: `restore --staged` has no HEAD to restore from.
      res = await execGitRaw(repo, ["rm", "--cached", "-r", "-q", "--", ...paths]);
    }
    if (res.code !== 0) fail("git.unstage", res, "git restore --staged failed");
    return { ok: true };
  });

  // Destructive: UI confirms first. `tracked` are reverted to the index,
  // `untracked` are deleted.
  define("git.discard", async (params, repo) => {
    const tracked = Array.isArray(params.tracked) ? params.tracked.map(String) : [];
    const untracked = Array.isArray(params.untracked) ? params.untracked.map(String) : [];
    if (tracked.length === 0 && untracked.length === 0) throw new Error("git.discard: nothing to discard");
    if (tracked.length > 0) {
      const res = await execGitRaw(repo, ["restore", "--", ...tracked]);
      if (res.code !== 0) fail("git.discard", res, "git restore failed");
    }
    if (untracked.length > 0) {
      const res = await execGitRaw(repo, ["clean", "-f", "-q", "--", ...untracked]);
      if (res.code !== 0) fail("git.discard", res, "git clean failed");
    }
    return { ok: true };
  });

  define("git.commit", async (params, repo) => {
    const message = String(params.message ?? "").trim();
    const amend = params.amend === true;
    if (!message && !amend) throw new Error("git.commit: message is required");
    const args = ["commit"];
    if (amend) args.push("--amend");
    if (message) args.push("-m", message);
    else args.push("--no-edit");
    const res = await execGitRaw(repo, args);
    if (res.code !== 0) fail("git.commit", res, "git commit failed");
    return { ok: true, output: res.stdout };
  });

  // ----- remote -----

  define("git.fetch", async (_params, repo) => {
    const res = await execGitRaw(repo, ["fetch", "--all", "--prune"], { timeoutMs: REMOTE_TIMEOUT_MS });
    if (res.code !== 0) fail("git.fetch", res, "git fetch failed");
    return { ok: true };
  });

  define("git.pull", async (params, repo) => {
    // ff-only by default: a diverged branch errors clearly instead of
    // silently creating a merge commit / opening an editor.
    const args =
      params.mode === "rebase"
        ? ["pull", "--rebase"]
        : params.mode === "merge"
          ? ["pull", "--no-rebase", "--no-edit"]
          : ["pull", "--ff-only"];
    const res = await execGitRaw(repo, args, { timeoutMs: REMOTE_TIMEOUT_MS });
    if (res.code !== 0) fail("git.pull", res, "git pull failed");
    return { ok: true, output: res.stdout };
  });

  define("git.push", async (params, repo) => {
    const args = ["push"];
    if (params.force === true) args.push("--force-with-lease");
    if (params.branch) {
      // Explicit branch (not necessarily the checked-out one): push it to its
      // configured remote, or to origin the first time (publishing it, -u).
      const branch = assertRef("git.push", params.branch, "branch");
      const cfg = await execGitRaw(repo, ["config", "--get", `branch.${branch}.remote`], { readOnly: true });
      const configured = cfg.code === 0 ? cfg.stdout.trim() : "";
      // "." means the upstream is another *local* branch — nothing to push to.
      const remote = configured && configured !== "." ? configured : "origin";
      if (!configured || configured === "." || params.setUpstream === true) args.push("-u");
      args.push(remote, branch);
    }
    const res = await execGitRaw(repo, args, { timeoutMs: REMOTE_TIMEOUT_MS });
    if (res.code !== 0) fail("git.push", res, "git push failed");
    return { ok: true, output: res.stderr || res.stdout };
  });

  // ----- merge -----

  define("git.merge", async (params, repo) => {
    if (params.abort === true) {
      const res = await execGitRaw(repo, ["merge", "--abort"]);
      if (res.code !== 0) fail("git.merge", res, "git merge --abort failed");
      return { ok: true };
    }
    const branch = assertRef("git.merge", params.branch, "branch");
    const res = await execGitRaw(repo, ["merge", "--no-edit", branch]);
    if (res.code === 0) return { ok: true, conflicts: false, output: res.stdout };
    // Conflicts are an expected outcome, not an error: the Changes list shows
    // the unmerged files and the UI offers "abort merge".
    if (/CONFLICT|Automatic merge failed/.test(res.stdout)) {
      return { ok: false, conflicts: true, output: res.stdout };
    }
    fail("git.merge", res, "git merge failed");
  });

  // ----- stash -----

  define("git.stashList", async (_params, repo) => {
    const res = await execGitRaw(repo, ["stash", "list", `--format=%gd${PRETTY_FIELD}%s${PRETTY_FIELD}%aI`], { readOnly: true });
    if (res.code !== 0) fail("git.stashList", res, "git stash list failed");
    const stashes = res.stdout
      .split("\n")
      .filter(Boolean)
      .map((line, index) => {
        const [, subject, date] = line.split("\0");
        return { index, subject, date };
      });
    return { stashes };
  });

  define("git.stashSave", async (params, repo) => {
    const args = ["stash", "push"];
    if (params.includeUntracked === true) args.push("--include-untracked");
    const message = String(params.message ?? "").trim();
    if (message) args.push("-m", message);
    const res = await execGitRaw(repo, args);
    if (res.code !== 0) fail("git.stashSave", res, "git stash failed");
    return { ok: true, output: res.stdout };
  });

  define("git.stashPop", async (params, repo) => {
    const res = await execGitRaw(repo, ["stash", "pop", assertStashIndex("git.stashPop", params.index)]);
    if (res.code !== 0) fail("git.stashPop", res, "git stash pop failed");
    return { ok: true };
  });

  define("git.stashApply", async (params, repo) => {
    const res = await execGitRaw(repo, ["stash", "apply", assertStashIndex("git.stashApply", params.index)]);
    if (res.code !== 0) fail("git.stashApply", res, "git stash apply failed");
    return { ok: true };
  });

  define("git.stashDrop", async (params, repo) => {
    const res = await execGitRaw(repo, ["stash", "drop", assertStashIndex("git.stashDrop", params.index)]);
    if (res.code !== 0) fail("git.stashDrop", res, "git stash drop failed");
    return { ok: true };
  });
}
