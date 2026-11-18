import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GitCloneError, cloneGitRepo, parseGitUrl, validateCloneFolderName } from "./gitClone.js";

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    return err instanceof GitCloneError ? err.code : "not-a-GitCloneError";
  }
  return undefined;
}

describe("parseGitUrl", () => {
  it("accepts GitHub HTTPS URLs and flags them for the token", () => {
    expect(parseGitUrl("https://github.com/acme/widgets.git")).toEqual({
      url: "https://github.com/acme/widgets.git",
      host: "github.com",
      defaultFolder: "widgets",
      githubHttps: true,
    });
    expect(parseGitUrl("  https://github.com/acme/widgets  ").defaultFolder).toBe("widgets");
  });

  it("expands owner/repo shorthand to GitHub HTTPS", () => {
    expect(parseGitUrl("acme/my.repo")).toEqual({
      url: "https://github.com/acme/my.repo.git",
      host: "github.com",
      defaultFolder: "my.repo",
      githubHttps: true,
    });
  });

  it("adds https:// to a host/path pasted from the address bar", () => {
    const parsed = parseGitUrl("gitlab.com/group/sub/project");
    expect(parsed.url).toBe("https://gitlab.com/group/sub/project");
    expect(parsed.defaultFolder).toBe("project");
    expect(parsed.githubHttps).toBe(false);
  });

  it("accepts ssh and scp-like URLs without the token", () => {
    expect(parseGitUrl("git@github.com:acme/widgets.git")).toMatchObject({
      host: "github.com",
      defaultFolder: "widgets",
      githubHttps: false,
    });
    expect(parseGitUrl("ssh://git@example.com:2222/team/app.git")).toMatchObject({
      host: "example.com",
      defaultFolder: "app",
      githubHttps: false,
    });
  });

  it("only sends the token to github.com over HTTPS", () => {
    expect(parseGitUrl("https://gitlab.com/acme/widgets.git").githubHttps).toBe(false);
    expect(parseGitUrl("http://github.com/acme/widgets.git").githubHttps).toBe(false);
    expect(parseGitUrl("https://github.com.evil.example/acme/widgets.git").githubHttps).toBe(false);
  });

  it("rejects empty input", () => {
    expect(codeOf(() => parseGitUrl("   "))).toBe("emptyUrl");
  });

  it("rejects strings git could treat as options, local paths or transport helpers", () => {
    expect(codeOf(() => parseGitUrl("--upload-pack=touch /tmp/x"))).toBe("invalidUrl");
    expect(codeOf(() => parseGitUrl("ext::sh -c touch% /tmp/x"))).toBe("invalidUrl");
    expect(codeOf(() => parseGitUrl("file:///etc"))).toBe("unsupportedProtocol");
    expect(codeOf(() => parseGitUrl("C:\\repos\\app"))).toBe("invalidUrl");
    expect(codeOf(() => parseGitUrl("C:/repos/app"))).toBe("invalidUrl");
    expect(codeOf(() => parseGitUrl("/home/me/repo"))).toBe("invalidUrl");
    expect(codeOf(() => parseGitUrl("https://github.com/acme/a b"))).toBe("invalidUrl");
  });

  it("rejects URLs without a repo path", () => {
    expect(codeOf(() => parseGitUrl("https://github.com/"))).toBe("invalidUrl");
  });
});

describe("validateCloneFolderName", () => {
  it("trims and keeps a plain name", () => {
    expect(validateCloneFolderName("  widgets ")).toBe("widgets");
    expect(validateCloneFolderName("my.repo")).toBe("my.repo");
  });

  it.each(["", ".", "..", "a/b", "a\\b", "-rf", "name.", "bad:name", "x".repeat(101)])("rejects %j", (name) => {
    expect(codeOf(() => validateCloneFolderName(name))).toBe("invalidFolder");
  });
});

describe("cloneGitRepo", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("clones a repo and reports a failing clone with cloneFailed", async () => {
    const root = mkdtempSync(join(tmpdir(), "ygg-clone-"));
    dirs.push(root);
    const source = join(root, "source");
    const git = (...args: string[]) => execFileSync("git", args, { cwd: source, stdio: "ignore" });
    execFileSync("git", ["init", "-q", source]);
    writeFileSync(join(source, "README.md"), "hi\n");
    git("add", ".");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");

    // parseGitUrl refuses local paths on purpose, so build the parsed shape directly.
    const target = join(root, "clone");
    await cloneGitRepo({ url: { url: source, host: "", defaultFolder: "source", githubHttps: false }, target });
    expect(existsSync(join(target, "README.md"))).toBe(true);

    await expect(
      cloneGitRepo({
        url: { url: join(root, "missing"), host: "", defaultFolder: "missing", githubHttps: false },
        target: join(root, "clone2"),
      }),
    ).rejects.toMatchObject({ code: "cloneFailed" });
    expect(existsSync(join(root, "clone2"))).toBe(false);
  });
});
