import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { appendFile, chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile, realpath } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { mergeConfig } from "@yggdrasil/config";
import { createDefaultGatewayContext, handleGatewayRequest, registerConnectionRemoteAddress } from "./methods.js";
import {
  classifyWorktreeOrigin,
  githubCompareUrl,
  parseBranches,
  parseClaudeLock,
  parseLog,
  parseNameStatus,
  parseStatusV2,
  parseWorktrees,
  samePath,
} from "./git-methods.js";

// The git.* methods under test run plain `git commit` / `git merge`; give them an identity so the
// suite also passes on machines without a global git config (e.g. CI runners).
process.env.GIT_AUTHOR_NAME ??= "Test";
process.env.GIT_AUTHOR_EMAIL ??= "t@t.dev";
process.env.GIT_COMMITTER_NAME ??= "Test";
process.env.GIT_COMMITTER_EMAIL ??= "t@t.dev";

let n = 0;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=t@t.dev", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
  });
}

async function newRepo(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  await writeFile(join(dir, "a.txt"), "one\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "first");
}

async function call(root: string, method: string, params: Record<string, unknown> = {}, loopback = true): Promise<any> {
  const ctx = await createDefaultGatewayContext(mergeConfig({}, {}), null, root);
  const connectionId = `git-test-${++n}`;
  if (loopback) registerConnectionRemoteAddress(connectionId, "127.0.0.1");
  const res = await handleGatewayRequest({ id: `r${n}`, method, params }, ctx, connectionId);
  if (res.error) throw new Error(res.error.message);
  return res.result;
}

async function tmp(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), "ygg-git-")));
}

describe("git parsers", () => {
  it("parseStatusV2 handles branch header, spaces in paths, renames, untracked", () => {
    const out = [
      "# branch.oid abc",
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +2 -1",
      "1 .M N... 100644 100644 100644 h h with space.txt",
      "2 R. N... 100644 100644 100644 h h R100 new name.txt",
      "old name.txt",
      "? untracked file.txt",
      "",
    ].join("\0");
    const s = parseStatusV2(out);
    expect(s.branch).toBe("main");
    expect(s.upstream).toBe("origin/main");
    expect([s.ahead, s.behind]).toEqual([2, 1]);
    expect(s.changes).toEqual([
      { path: "with space.txt", index: ".", worktree: "M", kind: "changed" },
      { path: "new name.txt", origPath: "old name.txt", index: "R", worktree: ".", kind: "renamed" },
      { path: "untracked file.txt", index: ".", worktree: "?", kind: "untracked" },
    ]);
  });

  it("parseBranches skips origin/HEAD and reads ahead/behind", () => {
    const line = (...f: string[]) => f.join("\0");
    const out = [
      line("refs/heads/main", "main", "origin/main", "ahead 1, behind 2", "*", "abc1234", "subj"),
      line("refs/remotes/origin/HEAD", "origin", "", "", " ", "abc1234", "subj"),
      line("refs/remotes/origin/main", "origin/main", "", "", " ", "abc1234", "subj"),
    ].join("\n");
    const b = parseBranches(out);
    expect(b.map((x) => x.name)).toEqual(["main", "origin/main"]);
    expect(b[0]).toMatchObject({ current: true, ahead: 1, behind: 2, remote: false });
    expect(b[1].remote).toBe(true);
  });

  it("parseLog and parseNameStatus", () => {
    const rec = ["h1", "h1s", "Ann", "a@a", "2026-01-01T00:00:00Z", "p1 p2", "HEAD -> main, tag: v1", "hello"].join("\0");
    const c = parseLog(`${rec}\x1e\n${rec}\x1e`);
    expect(c).toHaveLength(2);
    expect(c[0].parents).toEqual(["p1", "p2"]);
    expect(c[0].refs).toEqual(["HEAD -> main", "tag: v1"]);
    expect(parseNameStatus("M\0a b.txt\0R100\0old.txt\0new.txt\0A\0c.txt\0")).toEqual([
      { status: "M", path: "a b.txt" },
      { status: "R", origPath: "old.txt", path: "new.txt" },
      { status: "A", path: "c.txt" },
    ]);
  });
});

describe("worktree parsers", () => {
  const out = [
    "worktree /p/repo",
    "HEAD aaa",
    "branch refs/heads/main",
    "",
    "worktree /p/repo/.claude/worktrees/probe",
    "HEAD bbb",
    "branch refs/heads/worktree-probe",
    "locked claude session probe (pid 41087 start Mon Nov  2 17:03:23 2026)",
    "",
    "worktree /p/other",
    "HEAD ccc",
    "detached",
    "prunable gitdir file points to non-existent location",
    "",
  ].join("\n");

  it("parseWorktrees reads branch, detached, lock and prunable", () => {
    const list = parseWorktrees(out);
    expect(list.map((w) => [w.path, w.branch, w.main, w.detached, w.locked, w.prunable])).toEqual([
      ["/p/repo", "main", true, false, false, false],
      ["/p/repo/.claude/worktrees/probe", "worktree-probe", false, false, true, false],
      ["/p/other", undefined, false, true, false, true],
    ]);
    expect(list[1].lockReason).toMatch(/^claude session probe/);
  });

  it("classifies origin by location and reads Claude's lock", () => {
    expect(classifyWorktreeOrigin("/p/repo", "/p/repo")).toBe("main");
    expect(classifyWorktreeOrigin("/p/repo/.yggdrasil/worktrees/a", "/p/repo")).toBe("app");
    expect(classifyWorktreeOrigin("/p/repo/.claude/worktrees/a", "/p/repo")).toBe("claude");
    expect(classifyWorktreeOrigin("/p/repo-docs", "/p/repo")).toBe("manual");
    // Windows: git prints C:/..., Node says C:\\..., and the drive letter and folders are case-insensitive.
    expect(classifyWorktreeOrigin("C:/Users/me/repo", "C:\\Users\\me\\repo")).toBe("main");
    expect(classifyWorktreeOrigin("c:/users/me/Repo/.yggdrasil/worktrees/a", "C:\\Users\\me\\repo")).toBe("app");
    expect(classifyWorktreeOrigin("C:/Users/me/repo/.claude/worktrees/b", "C:/Users/me/repo")).toBe("claude");
    expect(classifyWorktreeOrigin("C:/Users/me/repo-docs", "C:/Users/me/repo")).toBe("manual");
    // POSIX stays case-sensitive.
    expect(classifyWorktreeOrigin("/p/Repo/.yggdrasil/worktrees/a", "/p/repo")).toBe("manual");
    expect(parseClaudeLock("claude session probe (pid 41087 start x)")).toEqual({ name: "probe", pid: 41087 });
    expect(parseClaudeLock("something else")).toBeUndefined();
  });
});

describe("git.* repository methods", () => {
  it("is refused for non-loopback, non-trusted connections", async () => {
    const root = await tmp();
    await newRepo(root);
    await expect(call(root, "git.repos", {}, false)).rejects.toThrow(/local app or a trusted device/);
  });

  it("git.repos: repo at root, repo in subfolder, none", async () => {
    const root = await tmp();
    await newRepo(root);
    const r1 = await call(root, "git.repos");
    expect(r1.repos[0]).toMatchObject({ path: ".", relation: "root", branch: "main" });

    const wrapper = await tmp();
    await newRepo(join(wrapper, "apps", "web"));
    await newRepo(join(wrapper, "api"));
    await mkdir(join(wrapper, "node_modules", "x", ".git"), { recursive: true });
    const r2 = await call(wrapper, "git.repos");
    expect(r2.repos.map((r: any) => r.path).sort()).toEqual(["api", "apps/web"]);
    expect(r2.repos.every((r: any) => r.relation === "child")).toBe(true);

    const empty = await tmp();
    expect((await call(empty, "git.repos")).repos).toEqual([]);
  });

  it("git.repos: project opened on a subfolder of a repo reports the parent", async () => {
    const top = await tmp();
    await newRepo(top);
    const sub = join(top, "packages", "x");
    await mkdir(sub, { recursive: true });
    const r = await call(sub, "git.repos");
    expect(r.repos[0]).toMatchObject({ path: "../..", relation: "parent" });
    // and it is addressable
    const status = await call(sub, "git.status2", { repo: "../.." });
    expect(status.branch).toBe("main");
  });

  it("rejects a repo path that escapes the project root", async () => {
    const root = await tmp();
    await newRepo(root);
    const other = await tmp();
    await newRepo(other);
    await expect(call(root, "git.status2", { repo: other })).rejects.toThrow(/escapes the project root/);
  });

  it("status2 / stage / unstage / commit / log / show / diff2 round trip", async () => {
    const root = await tmp();
    await newRepo(root);
    await writeFile(join(root, "a.txt"), "one\ntwo\n");
    await writeFile(join(root, "new file.txt"), "x\n");

    let s = await call(root, "git.status2");
    expect(s.changes.map((c: any) => [c.path, c.worktree])).toEqual([
      ["a.txt", "M"],
      ["new file.txt", "?"],
    ]);

    const d = await call(root, "git.diff2", { path: "a.txt", mode: "unstaged" });
    expect(d).toEqual({ original: "one\n", modified: "one\ntwo\n" });

    await call(root, "git.stage", { paths: ["a.txt", "new file.txt"] });
    s = await call(root, "git.status2");
    expect(s.changes.every((c: any) => c.index !== ".")).toBe(true);
    const staged = await call(root, "git.diff2", { path: "a.txt", mode: "staged" });
    expect(staged).toEqual({ original: "one\n", modified: "one\ntwo\n" });

    await call(root, "git.unstage", { paths: ["new file.txt"] });
    s = await call(root, "git.status2");
    expect(s.changes.find((c: any) => c.path === "new file.txt").worktree).toBe("?");

    await call(root, "git.stage", { all: true });
    await call(root, "git.commit", { message: "second" });
    const log = await call(root, "git.log", {});
    expect(log.commits.map((c: any) => c.subject)).toEqual(["second", "first"]);

    const show = await call(root, "git.show", { sha: log.commits[0].sha });
    expect(show.message).toBe("second");
    expect(show.files.map((f: any) => [f.status, f.path]).sort()).toEqual([
      ["A", "new file.txt"],
      ["M", "a.txt"],
    ]);
    const cd = await call(root, "git.diff2", { path: "a.txt", mode: "commit", sha: log.commits[0].sha });
    expect(cd).toEqual({ original: "one\n", modified: "one\ntwo\n" });
  });

  it("commit requires a message; empty repo log is empty", async () => {
    const root = await tmp();
    await mkdir(root, { recursive: true });
    git(root, "init", "-q", "-b", "main");
    expect((await call(root, "git.log", {})).commits).toEqual([]);
    await expect(call(root, "git.commit", { message: "  " })).rejects.toThrow(/message is required/);
  });

  it("checkout: create, switch, blocked when dirty changes would be overwritten", async () => {
    const root = await tmp();
    await newRepo(root);
    await call(root, "git.checkout", { branch: "feat", create: true });
    await writeFile(join(root, "a.txt"), "feat\n");
    git(root, "commit", "-qam", "feat change");
    await call(root, "git.checkout", { branch: "main" });
    expect(git(root, "branch", "--show-current").trim()).toBe("main");

    await call(root, "git.checkout", { branch: "feat" });
    await writeFile(join(root, "a.txt"), "dirty\n");
    // main has "one", feat has "feat", dirty edit conflicts with switching back
    await expect(call(root, "git.checkout", { branch: "main" })).rejects.toThrow(/overwritten|local changes/i);
    expect(git(root, "branch", "--show-current").trim()).toBe("feat");

    await expect(call(root, "git.checkout", { branch: "-evil" })).rejects.toThrow(/invalid branch/);
    await expect(call(root, "git.checkout", { branch: "bad name", create: true })).rejects.toThrow(/invalid branch name/);
  });

  it("branches lists local branches with current flag; branchDelete", async () => {
    const root = await tmp();
    await newRepo(root);
    git(root, "branch", "topic");
    const { branches } = await call(root, "git.branches");
    expect(branches.map((b: any) => [b.name, b.current])).toEqual([
      ["main", true],
      ["topic", false],
    ]);
    await call(root, "git.branchDelete", { branch: "topic" });
    expect((await call(root, "git.branches")).branches).toHaveLength(1);
  });

  it("merge conflict is reported (not thrown) and can be aborted", async () => {
    const root = await tmp();
    await newRepo(root);
    git(root, "switch", "-q", "-c", "other");
    await writeFile(join(root, "a.txt"), "other\n");
    git(root, "commit", "-qam", "other");
    git(root, "switch", "-q", "main");
    await writeFile(join(root, "a.txt"), "main\n");
    git(root, "commit", "-qam", "main");

    const m = await call(root, "git.merge", { branch: "other" });
    expect(m).toMatchObject({ ok: false, conflicts: true });
    const s = await call(root, "git.status2");
    expect(s.merging).toBe(true);
    expect(s.changes.find((c: any) => c.path === "a.txt").kind).toBe("unmerged");

    await call(root, "git.merge", { abort: true });
    expect((await call(root, "git.status2")).merging).toBe(false);
  });

  it("discard reverts tracked and removes untracked; stash save/list/pop", async () => {
    const root = await tmp();
    await newRepo(root);
    await writeFile(join(root, "a.txt"), "changed\n");
    await writeFile(join(root, "u.txt"), "u\n");
    await call(root, "git.discard", { tracked: ["a.txt"], untracked: ["u.txt"] });
    expect((await call(root, "git.status2")).changes).toEqual([]);

    await writeFile(join(root, "a.txt"), "stash me\n");
    await call(root, "git.stashSave", { message: "wip" });
    expect((await call(root, "git.status2")).changes).toEqual([]);
    const { stashes } = await call(root, "git.stashList");
    expect(stashes).toHaveLength(1);
    expect(stashes[0].subject).toMatch(/wip/);
    await call(root, "git.stashPop", { index: 0 });
    expect((await call(root, "git.status2")).changes).toHaveLength(1);
    await expect(call(root, "git.stashPop", { index: "0; rm" })).rejects.toThrow(/invalid stash index/);
  });

  it("git.init creates a repo in the root", async () => {
    const root = await tmp();
    await call(root, "git.init", {});
    expect((await call(root, "git.repos")).repos[0]).toMatchObject({ path: ".", relation: "root" });
    await expect(call(root, "git.init", { path: ".." })).rejects.toThrow(/escapes/);
  });

  it("git.remotes lists fetch urls; none for a fresh repo", async () => {
    const root = await tmp();
    await newRepo(root);
    expect((await call(root, "git.remotes")).remotes).toEqual([]);
    git(root, "remote", "add", "origin", "git@github.com:acme/widgets.git");
    git(root, "remote", "add", "up", "https://gitlab.com/acme/w.git");
    expect((await call(root, "git.remotes")).remotes).toEqual([
      { name: "origin", url: "git@github.com:acme/widgets.git" },
      { name: "up", url: "https://gitlab.com/acme/w.git" },
    ]);
  });

  it("checkout create from a start point branches off that branch, not HEAD", async () => {
    const root = await tmp();
    await newRepo(root);
    git(root, "switch", "-q", "-c", "base");
    await writeFile(join(root, "b.txt"), "b\n");
    git(root, "add", "-A");
    git(root, "commit", "-qm", "on base");
    git(root, "switch", "-q", "main");
    await call(root, "git.checkout", { branch: "child", create: true, startPoint: "base" });
    expect(git(root, "branch", "--show-current").trim()).toBe("child");
    expect(git(root, "log", "-1", "--format=%s").trim()).toBe("on base");
  });

  it("push of a non-current branch publishes it (-u) to origin, then reuses its remote", async () => {
    const root = await tmp();
    await newRepo(root);
    const bare = await tmp();
    git(bare, "init", "-q", "--bare");
    git(root, "remote", "add", "origin", bare);
    git(root, "branch", "topic");
    expect(git(root, "branch", "--show-current").trim()).toBe("main");

    await call(root, "git.push", { branch: "topic" });
    expect(git(bare, "branch", "--list", "topic").trim()).toBe("topic");
    expect(git(root, "config", "--get", "branch.topic.remote").trim()).toBe("origin");

    git(root, "switch", "-q", "topic");
    await writeFile(join(root, "t.txt"), "t\n");
    git(root, "add", "-A");
    git(root, "commit", "-qm", "more");
    git(root, "switch", "-q", "main");
    await call(root, "git.push", { branch: "topic" });
    expect(git(bare, "log", "topic", "-1", "--format=%s").trim()).toBe("more");
  });
  it("git.worktrees lists the main checkout and linked ones with origin, changes and ahead", async () => {
    const root = await tmp();
    await newRepo(root);
    await mkdir(join(root, ".yggdrasil", "worktrees"), { recursive: true });
    // What the app's "create worktree" will do (W2); without it the main checkout reports the folder as untracked.
    await appendFile(join(root, ".git", "info", "exclude"), ".yggdrasil/worktrees/\n");
    const appWt = join(root, ".yggdrasil", "worktrees", "feat");
    git(root, "worktree", "add", "-q", "-b", "ygg/feat", appWt);
    await writeFile(join(appWt, "b.txt"), "two\n");
    git(appWt, "add", "-A");
    git(appWt, "commit", "-q", "-m", "second");
    await writeFile(join(appWt, "c.txt"), "dirty\n");

    const res = await call(root, "git.worktrees");
    expect(res.base).toBe("main");
    const byBranch = Object.fromEntries(res.worktrees.map((w: any) => [w.branch, w]));
    expect(byBranch.main).toMatchObject({ main: true, origin: "main", changes: 0, ahead: 0 });
    expect(byBranch["ygg/feat"]).toMatchObject({ main: false, origin: "app", changes: 1, ahead: 1, missing: false });
  });
  it("git.checkouts lists where each checkout is and its branch, without status", async () => {
    const root = await tmp();
    await newRepo(root);
    const added = await call(root, "git.worktreeAdd", { name: "feat-c", base: "main" });
    const res = await call(root, "git.checkouts");
    const byBranch = Object.fromEntries(res.checkouts.map((c: any) => [c.branch, c]));
    expect(Object.keys(byBranch).sort()).toEqual(["main", "ygg/feat-c"]);
    expect(byBranch["ygg/feat-c"]).toMatchObject({ detached: false });
    // git prints C:/..., Node says C:\... on Windows.
    expect(samePath(byBranch["ygg/feat-c"].path, added.path)).toBe(true);
    expect(byBranch["ygg/feat-c"]).not.toHaveProperty("changes");
  });
  it("git.worktreeAdd creates an app worktree on ygg/<name>, excluded from the main checkout", async () => {
    const root = await tmp();
    await newRepo(root);
    const res = await call(root, "git.worktreeAdd", { name: "feat-a", base: "main" });
    expect(res).toMatchObject({ branch: "ygg/feat-a", base: "main" });
    expect(res.path).toBe(join(root, ".yggdrasil", "worktrees", "feat-a"));

    const list = await call(root, "git.worktrees");
    const byBranch = Object.fromEntries(list.worktrees.map((w: any) => [w.branch, w]));
    expect(byBranch["ygg/feat-a"]).toMatchObject({ origin: "app", missing: false });
    // The new folder must not show up as untracked in the main checkout.
    expect(byBranch.main.changes).toBe(0);

    // The exclude entry is written once, however many worktrees follow.
    await call(root, "git.worktreeAdd", { name: "feat-b" });
    const exclude = await readFile(join(root, ".git", "info", "exclude"), "utf8");
    expect(exclude.split("\n").filter((l) => l.trim() === ".yggdrasil/worktrees/")).toHaveLength(1);
  });

  it("git.worktreeAdd refuses a repeated name, a taken branch and a name Claude already uses", async () => {
    const root = await tmp();
    await newRepo(root);
    await call(root, "git.worktreeAdd", { name: "dup" });
    await expect(call(root, "git.worktreeAdd", { name: "dup" })).rejects.toThrow(/already exists/);

    git(root, "branch", "ygg/taken");
    await expect(call(root, "git.worktreeAdd", { name: "taken" })).rejects.toThrow(/branch ygg\/taken already exists/);

    await mkdir(join(root, ".claude", "worktrees", "claude-made"), { recursive: true });
    await expect(call(root, "git.worktreeAdd", { name: "claude-made" })).rejects.toThrow(/used by a Claude worktree/);

    await expect(call(root, "git.worktreeAdd", { name: "../evil" })).rejects.toThrow(/invalid worktree name/);
    await expect(call(root, "git.worktreeAdd", { name: "x", base: "no-such-branch" })).rejects.toThrow();
  });
  it("git.repos does not list the worktrees kept under .yggdrasil/ or .claude/ as repositories", async () => {
    const root = await tmp();
    await newRepo(root);
    await call(root, "git.worktreeAdd", { name: "kept" });
    const res = await call(root, "git.repos");
    expect(res.repos.map((r: any) => r.path)).toEqual(["."]);
  });
});

describe("closing worktrees", () => {
  async function appWorktree(root: string, name: string, commit = true): Promise<string> {
    const info = await call(root, "git.worktreeAdd", { name });
    if (commit) {
      await writeFile(join(info.path, `${name}.txt`), `${name}\n`);
      git(info.path, "add", "-A");
      git(info.path, "commit", "-q", "-m", `work on ${name}`);
    }
    return info.path;
  }

  const branches = (root: string): string[] => git(root, "branch", "--format=%(refname:short)").split("\n").filter(Boolean);

  it("samePath ignores separators and, for Windows paths, case", () => {
    expect(samePath("/p/repo/.yggdrasil/worktrees/a/", "/p/repo/.yggdrasil/worktrees/a")).toBe(true);
    expect(samePath("/p/Repo", "/p/repo")).toBe(false);
    expect(samePath("C:/Users/me/repo/wt", "c:\\users\\me\\Repo\\wt")).toBe(true);
  });

  it("githubCompareUrl builds the pull request page from https and ssh origins", () => {
    const want = "https://github.com/acme/app/compare/main...ygg/feat?expand=1";
    expect(githubCompareUrl("https://github.com/acme/app.git", "main", "ygg/feat")).toBe(want);
    expect(githubCompareUrl("git@github.com:acme/app.git\n", "main", "ygg/feat")).toBe(want);
    expect(githubCompareUrl("https://gitlab.com/acme/app.git", "main", "x")).toBeUndefined();
  });

  it("merging an app worktree's branch, then removing it with its branch, leaves the work on main", async () => {
    const root = await tmp();
    await newRepo(root);
    const wt = await appWorktree(root, "done");
    const merged = await call(root, "git.merge", { branch: "ygg/done" });
    expect(merged).toMatchObject({ ok: true, conflicts: false });
    const res = await call(root, "git.worktreeRemove", { path: wt, deleteBranch: true });
    expect(res).toMatchObject({ ok: true, branchDeleted: true });
    expect(branches(root)).toEqual(["main"]);
    expect(git(root, "worktree", "list", "--porcelain")).not.toContain("done");
    // trim: git on Windows may check the file out with CRLF.
    expect((await readFile(join(root, "done.txt"), "utf8")).trim()).toBe("done");
  });

  it("refuses to remove a worktree with uncommitted changes unless forced; force also drops the branch", async () => {
    const root = await tmp();
    await newRepo(root);
    const wt = await appWorktree(root, "wip");
    await writeFile(join(wt, "scratch.txt"), "x\n");
    await expect(call(root, "git.worktreeRemove", { path: wt })).rejects.toThrow(/uncommitted changes/);
    expect(branches(root)).toContain("ygg/wip");

    // Unmerged commits: a safe branch delete leaves the branch and says why.
    await call(root, "git.stage", { repo: relOf(root, wt), all: true });
    git(wt, "commit", "-q", "-m", "more");
    const safe = await call(root, "git.worktreeRemove", { path: wt, deleteBranch: true });
    expect(safe.branchDeleted).toBe(false);
    expect(safe.branchError).toMatch(/not fully merged/);
    expect(branches(root)).toContain("ygg/wip");

    const wt2 = await appWorktree(root, "wip2");
    await writeFile(join(wt2, "scratch.txt"), "x\n");
    const forced = await call(root, "git.worktreeRemove", { path: wt2, force: true, deleteBranch: true });
    expect(forced).toMatchObject({ ok: true, branchDeleted: true });
    expect(branches(root)).not.toContain("ygg/wip2");
  });

  it("never removes the main checkout or a path that isn't a worktree of the repo", async () => {
    const root = await tmp();
    await newRepo(root);
    await expect(call(root, "git.worktreeRemove", { path: root, force: true })).rejects.toThrow(/main checkout/);
    await expect(call(root, "git.worktreeRemove", { path: join(root, "nope") })).rejects.toThrow(/not a worktree/);
    await expect(call(root, "git.worktreeRemove", {})).rejects.toThrow(/path is required/);
  });

  it("releases a stale Claude lock before removing, but not one whose session is still running", async () => {
    const root = await tmp();
    await newRepo(root);
    const stale = await appWorktree(root, "stale");
    git(root, "worktree", "lock", "--reason", "claude session stale (pid 2147483646 start 1)", stale);
    expect((await call(root, "git.worktreeRemove", { path: stale })).ok).toBe(true);
    expect(git(root, "worktree", "list", "--porcelain")).not.toContain("stale");

    const live = await appWorktree(root, "live");
    git(root, "worktree", "lock", "--reason", `claude session live (pid ${process.pid} start 1)`, live);
    await expect(call(root, "git.worktreeRemove", { path: live, force: true })).rejects.toThrow(/still running/);

    const manual = await appWorktree(root, "manual");
    git(root, "worktree", "lock", "--reason", "keep me", manual);
    await expect(call(root, "git.worktreeRemove", { path: manual })).rejects.toThrow(/locked \(keep me\)/);
  });

  it("removes a worktree whose folder is already gone by pruning it", async () => {
    const root = await tmp();
    await newRepo(root);
    const wt = await appWorktree(root, "gone");
    await rm(wt, { recursive: true, force: true });
    const res = await call(root, "git.worktreeRemove", { path: wt, deleteBranch: true, force: true });
    expect(res.ok).toBe(true);
    expect(git(root, "worktree", "list", "--porcelain")).not.toContain("gone");
    expect(branches(root)).not.toContain("ygg/gone");
  });

  describe.skipIf(process.platform === "win32")("git.pullRequest", () => {
    async function withFakeGh(script: string, run: () => Promise<void>): Promise<void> {
      const bin = await tmp();
      await writeFile(join(bin, "gh"), `#!/bin/sh\n${script}\n`);
      await chmod(join(bin, "gh"), 0o755);
      const before = process.env.PATH;
      process.env.PATH = `${bin}:${before}`;
      try {
        await run();
      } finally {
        process.env.PATH = before;
      }
    }
    const args = { branch: "ygg/feat", base: "main", title: "Feat", body: "body" };

    it("opens the PR with gh and returns its URL", async () => {
      const root = await tmp();
      await newRepo(root);
      git(root, "remote", "add", "origin", "https://github.com/acme/app.git");
      await withFakeGh('echo "$@" > "$GH_ARGS_FILE"; echo https://github.com/acme/app/pull/7', async () => {
        const argsFile = join(await tmp(), "args");
        process.env.GH_ARGS_FILE = argsFile;
        const res = await call(root, "git.pullRequest", args);
        expect(res).toMatchObject({ created: true, url: "https://github.com/acme/app/pull/7" });
        expect(res.compareUrl).toContain("/compare/main...ygg/feat");
        expect(await readFile(argsFile, "utf8")).toContain("--head ygg/feat --base main --title Feat --body body");
        delete process.env.GH_ARGS_FILE;
      });
    });

    it("returns the existing PR when the branch already has one, and surfaces other gh errors", async () => {
      const root = await tmp();
      await newRepo(root);
      await withFakeGh('echo "a pull request for branch already exists: https://github.com/acme/app/pull/3" >&2; exit 1', async () => {
        expect(await call(root, "git.pullRequest", args)).toMatchObject({
          created: false,
          reason: "exists",
          url: "https://github.com/acme/app/pull/3",
        });
      });
      await withFakeGh('echo "gh: not logged in" >&2; exit 1', async () => {
        await expect(call(root, "git.pullRequest", args)).rejects.toThrow(/not logged in/);
      });
    });

    it("says gh is missing (and still hands back the compare page) when it isn't installed", async () => {
      const root = await tmp();
      await newRepo(root);
      git(root, "remote", "add", "origin", "git@github.com:acme/app.git");
      // A PATH holding only git: a symlink in an otherwise empty folder.
      const bin = await tmp();
      await symlink(execFileSync("which", ["git"], { encoding: "utf8" }).trim(), join(bin, "git"));
      const before = process.env.PATH;
      process.env.PATH = bin;
      try {
        const res = await call(root, "git.pullRequest", args);
        expect(res).toMatchObject({ created: false, reason: "gh-missing" });
        expect(res.compareUrl).toBe("https://github.com/acme/app/compare/main...ygg/feat?expand=1");
      } finally {
        process.env.PATH = before;
      }
    });

    it("needs a title", async () => {
      const root = await tmp();
      await newRepo(root);
      await expect(call(root, "git.pullRequest", { ...args, title: " " })).rejects.toThrow(/title is required/);
    });
  });
});

function relOf(root: string, abs: string): string {
  return relative(root, abs).split(sep).join("/");
}
