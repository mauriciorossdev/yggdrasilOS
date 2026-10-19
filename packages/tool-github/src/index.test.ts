import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deleteGithubAccount, getGithubAccount, saveGithubAccount } from "./account.js";
import { pollForToken } from "./oauth.js";
import { listRepos } from "./github-api.js";
import { cloneRepo } from "./clone.js";

function mockFetch(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status: init.status ?? 200, headers: init.headers }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("tool-github", () => {
  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "ygg-gh-"));
    process.env.YGGDRASIL_GITHUB_ACCOUNT_FILE = join(dir, "acct.json");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.YGGDRASIL_GITHUB_ACCOUNT_FILE;
  });

  it("stores, reads and deletes the account", async () => {
    expect(await getGithubAccount()).toBeNull();
    await saveGithubAccount({ accessToken: "t", scopes: ["repo"], login: "me", connectedAt: 1 });
    expect((await getGithubAccount())?.login).toBe("me");
    expect(JSON.parse(await readFile(process.env.YGGDRASIL_GITHUB_ACCOUNT_FILE!, "utf8")).accessToken).toBe("t");
    await deleteGithubAccount();
    expect(await getGithubAccount()).toBeNull();
  });

  it("maps device-flow poll responses", async () => {
    mockFetch({ error: "authorization_pending" });
    expect(await pollForToken("cid", "dc")).toEqual({ status: "pending" });
    mockFetch({ error: "slow_down", interval: 10 });
    expect(await pollForToken("cid", "dc")).toEqual({ status: "pending", interval: 10 });
    mockFetch({ access_token: "tok", scope: "repo,user" });
    expect(await pollForToken("cid", "dc")).toEqual({ status: "authorized", accessToken: "tok", scopes: ["repo", "user"] });
    mockFetch({ error: "expired_token", error_description: "expired" });
    expect(await pollForToken("cid", "dc")).toEqual({ status: "error", error: "expired" });
  });

  it("lists repos and reports pagination", async () => {
    const fetchMock = mockFetch(
      [
        {
          full_name: "me/app",
          name: "app",
          owner: { login: "me" },
          description: null,
          private: true,
          fork: false,
          default_branch: "main",
          clone_url: "https://github.com/me/app.git",
          html_url: "https://github.com/me/app",
          pushed_at: "2026-01-01T00:00:00Z",
          updated_at: "2025-01-01T00:00:00Z",
        },
      ],
      { headers: { link: '<https://api.github.com/user/repos?page=2>; rel="next"' } },
    );
    const res = await listRepos("tok", { page: 1 });
    expect(res.hasMore).toBe(true);
    expect(res.repos[0]).toMatchObject({ fullName: "me/app", private: true, updatedAt: "2026-01-01T00:00:00Z" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects bad repo names and folder names before touching git", async () => {
    await expect(cloneRepo("tok", { repo: "not a repo", parentDir: tmpdir() })).rejects.toThrow(/Invalid repo/);
    mockFetch({
      full_name: "me/app",
      name: "app",
      owner: { login: "me" },
      description: null,
      private: false,
      fork: false,
      default_branch: "main",
      clone_url: "https://github.com/me/app.git",
      html_url: "",
      pushed_at: null,
      updated_at: "x",
    });
    await expect(cloneRepo("tok", { repo: "me/app", parentDir: tmpdir(), folderName: "../evil" })).rejects.toThrow(
      /Invalid folder name/,
    );
  });
});
