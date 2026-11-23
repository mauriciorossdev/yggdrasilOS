import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
  sanitizeNewCodeComment,
  type CodeComment,
  type CodeCommentStatus,
  type NewCodeComment,
} from "./codeComments.js";
import { buildCodeReviewPrompt } from "./codeCommentsPrompt.js";
import { deliverTask, type CommentProvider, type PanesApi, type TaskTarget } from "./taskDelivery.js";

const execFileAsync = promisify(execFile);

/** Where a project path lives, git-wise: the repo/worktree root (real path) and the path relative to it. */
export type RepoLocation = { root: string; path: string; label: string };

export type CodeCommentsHostDeps = {
  projectPath: () => Promise<string>;
  store: {
    list: (root: string) => Promise<CodeComment[]>;
    add: (root: string, input: NewCodeComment) => Promise<CodeComment>;
    update: (root: string, id: string, text: string) => Promise<void>;
    remove: (root: string, id: string) => Promise<void>;
    clearDone: (root: string) => Promise<void>;
    /** Drops every comment of a root (its worktree was removed). */
    dropRoot: (root: string) => Promise<void>;
    setStatus: (ids: string[], status: CodeCommentStatus, sentTo?: string) => Promise<string[]>;
  };
  panes: PanesApi;
  providers: () => CommentProvider[];
  /** Tells the window that a repo root's comments changed. */
  changed: (root: string) => void;
  /** Overridable for tests. */
  gitToplevel?: (dir: string) => Promise<string | undefined>;
  sleep?: (ms: number) => Promise<void>;
};

async function defaultGitToplevel(dir: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, timeout: 5000 });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function real(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

const toPosix = (p: string) => p.split(sep).join("/");

function isInside(base: string, p: string): boolean {
  const rel = relative(base, p);
  return !rel.startsWith("..") && !isAbsolute(rel);
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** "el worktree fix-x" for an app/claude worktree, "el repositorio my-app" otherwise; plus the absolute path. */
export function repoLabel(root: string): string {
  const parts = toPosix(root).split("/");
  const i = parts.lastIndexOf("worktrees");
  const isWorktree = i > 0 && i === parts.length - 2 && (parts[i - 1] === ".yggdrasil" || parts[i - 1] === ".claude");
  return `${isWorktree ? "el worktree" : "el repositorio"} ${basename(root)} (${root})`;
}

export function createCodeCommentsHost(deps: CodeCommentsHostDeps) {
  const sleep = deps.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const toplevel = deps.gitToplevel ?? defaultGitToplevel;
  const knownRoots = new Set<string>();

  /** Only roots this host resolved itself are accepted back from the renderer. */
  function checkRoot(root: unknown): string {
    if (typeof root !== "string" || !knownRoots.has(root)) throw new Error("Unknown repository root");
    return root;
  }

  return {
    /** `target` is project-relative (or absolute inside the project): a file, or a repo/worktree folder. */
    async locate(target: string): Promise<RepoLocation | undefined> {
      const project = resolve(await deps.projectPath());
      const abs = isAbsolute(target) ? resolve(target) : resolve(project, target);
      // Inside the project, or inside the repo that contains it (a project opened on a subfolder of a bigger repo).
      const projectTop = await toplevel(project);
      if (!isInside(project, abs) && !(projectTop && isInside(resolve(projectTop), abs))) return undefined;
      // A file deleted in the diff (or a deleted folder) still belongs to the repo of its nearest existing folder.
      let dir = abs;
      while (!(await isDir(dir))) {
        const up = dirname(dir);
        if (up === dir) return undefined;
        dir = up;
      }
      const top = await toplevel(dir);
      if (!top) return undefined;
      const root = await real(top);
      const realDir = await real(dir);
      const path = toPosix(relative(root, resolve(realDir, relative(dir, abs))));
      knownRoots.add(root);
      return { root, path: path.startsWith("..") ? "" : path, label: repoLabel(root) };
    },

    list: (root: string) => deps.store.list(checkRoot(root)),

    async add(root: string, input: unknown): Promise<CodeComment> {
      const clean = sanitizeNewCodeComment(input);
      if (!clean) throw new Error("Invalid comment");
      const r = checkRoot(root);
      const comment = await deps.store.add(r, clean);
      deps.changed(r);
      return comment;
    },

    async update(root: string, id: string, text: string): Promise<void> {
      const r = checkRoot(root);
      await deps.store.update(r, String(id), String(text));
      deps.changed(r);
    },

    async remove(root: string, id: string): Promise<void> {
      const r = checkRoot(root);
      await deps.store.remove(r, String(id));
      deps.changed(r);
    },

    async clearDone(root: string): Promise<void> {
      const r = checkRoot(root);
      await deps.store.clearDone(r);
      deps.changed(r);
    },

    /**
     * A worktree was removed: its comments go too. `path` is the worktree's absolute path as git lists
     * it; the stored root is its real path, as locate() resolved it, so both spellings are tried.
     */
    async dropRoot(path: string): Promise<void> {
      if (typeof path !== "string" || !isAbsolute(path)) return;
      for (const root of new Set([resolve(path), await real(path)])) {
        await deps.store.dropRoot(root);
        knownRoots.delete(root);
        deps.changed(root);
      }
    },

    /** From the card's "Resolver" / "Reabrir", or the agent's code_comment_done. False when no id matched. */
    async setStatus(ids: string[], status: CodeCommentStatus): Promise<boolean> {
      const roots = await deps.store.setStatus(ids.map(String), status === "done" ? "done" : status === "sent" ? "sent" : "idle");
      roots.forEach((r) => deps.changed(r));
      return roots.length > 0;
    },

    /** Live panes (with their real cwd, to suggest the one working in this repo) and the CLIs that can be launched. */
    async targets() {
      // Only agent panes: a plain shell would run the prompt (code blocks included) line by line.
      const panes = (await deps.panes.list()).filter((p) => p.command);
      return {
        panes: await Promise.all(panes.map(async (p) => ({ ...p, cwd: p.cwd ? await real(p.cwd) : undefined }))),
        providers: deps.providers(),
      };
    },

    async send(req: {
      root: string;
      ids?: string[];
      target: TaskTarget;
    }): Promise<{ ok: boolean; error?: string; queued?: boolean; position?: number }> {
      try {
        const root = checkRoot(req.root);
        if (req.target.kind === "pane") {
          const paneId = req.target.paneId;
          const pane = (await deps.panes.list()).find((p) => p.id === paneId);
          if (!pane?.command) throw new Error("That pane is not running an agent");
        }
        const all = await deps.store.list(root);
        const pending = all.filter((c) => c.status !== "done");
        const chosen = req.ids ? pending.filter((c) => req.ids!.includes(c.id)) : pending.filter((c) => c.status === "idle");
        if (chosen.length === 0) return { ok: false, error: "No comments to send" };
        const text = buildCodeReviewPrompt(chosen, repoLabel(root));
        const sent = await deliverTask({ panes: deps.panes, providers: deps.providers, sleep }, req.target, text, root);
        await deps.store.setStatus(chosen.map((c) => c.id), "sent", sent.name);
        deps.changed(root);
        return { ok: true, ...(sent.queued ? { queued: true, position: sent.position } : {}) };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

export type CodeCommentsHost = ReturnType<typeof createCodeCommentsHost>;
