import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppWorktree, repoToplevel, slugifyWorktreeName, validateWorktreeName } from "./index.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@t.dev", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
  });
}

async function newRepo(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "ygg-wt-")));
  git(dir, "init", "-q", "-b", "main");
  await writeFile(join(dir, "a.txt"), "one\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "first");
  return dir;
}

describe("validateWorktreeName / slugifyWorktreeName", () => {
  it("accepts a slug and rejects anything that could escape the folder or break a branch", () => {
    expect(validateWorktreeName(" front-2 ")).toBe("front-2");
    for (const bad of ["", "-x", ".hidden", "a/b", "a b", "a..b", "x.lock", "../up", "a".repeat(65)]) {
      expect(() => validateWorktreeName(bad), bad).toThrow(/invalid worktree name/);
    }
  });
  it("slugifies free text into a valid name, or nothing", () => {
    expect(slugifyWorktreeName("Front end — login")).toBe("front-end-login");
    expect(slugifyWorktreeName("  ///  ")).toBe("");
    for (const text of ["Revisor de código", "a..b", "x.lock", "Ünï cödé"]) {
      const slug = slugifyWorktreeName(text);
      if (slug) expect(() => validateWorktreeName(slug), text).not.toThrow();
    }
  });
});

describe("createAppWorktree", () => {
  it("creates the folder on ygg/<name>, writes the exclude entry once and refuses a repeat", async () => {
    const repo = await newRepo();
    const res = await createAppWorktree(repo, { name: "a", base: "main" });
    expect(res).toEqual({ path: join(repo, ".yggdrasil", "worktrees", "a"), branch: "ygg/a", base: "main" });
    await createAppWorktree(repo, { name: "b" });
    const exclude = await readFile(join(repo, ".git", "info", "exclude"), "utf8");
    expect(exclude.split("\n").filter((l) => l.trim() === ".yggdrasil/worktrees/")).toHaveLength(1);
    expect(git(repo, "status", "--porcelain")).toBe("");
    await expect(createAppWorktree(repo, { name: "a" })).rejects.toThrow(/already exists/);
  });

  it("refuses a taken branch, a Claude name and an unknown base", async () => {
    const repo = await newRepo();
    git(repo, "branch", "ygg/taken");
    await expect(createAppWorktree(repo, { name: "taken" })).rejects.toThrow(/branch ygg\/taken already exists/);
    await mkdir(join(repo, ".claude", "worktrees", "made-by-claude"), { recursive: true });
    await expect(createAppWorktree(repo, { name: "made-by-claude" })).rejects.toThrow(/used by a Claude worktree/);
    await expect(createAppWorktree(repo, { name: "x", base: "nope" })).rejects.toThrow();
    await expect(createAppWorktree(repo, { name: "y", base: "--evil" })).rejects.toThrow(/invalid base/);
  });

  it("repoToplevel finds the repo or says there is none", async () => {
    const repo = await newRepo();
    expect(await repoToplevel(join(repo))).toBe(repo);
    expect(await repoToplevel(await realpath(await mkdtemp(join(tmpdir(), "ygg-nogit-"))))).toBeNull();
  });
});
