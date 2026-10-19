import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mergeConfig } from "@yggdrasil/config";
import { createDefaultGatewayContext, handleGatewayRequest, registerConnectionRemoteAddress } from "./methods.js";
import { parseBranches, parseLog, parseNameStatus, parseStatusV2 } from "./git-methods.js";

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
});
