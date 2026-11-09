import { describe, expect, it } from "vitest";
import { isNewerVersion, parseLatestRelease } from "./updateCheckCore.js";

describe("isNewerVersion", () => {
  it("compares each part as a number", () => {
    expect(isNewerVersion("0.1.10", "0.1.9")).toBe(true);
    expect(isNewerVersion("0.2.0", "0.1.99")).toBe(true);
    expect(isNewerVersion("1.0.0", "0.9.9")).toBe(true);
    expect(isNewerVersion("0.1.9", "0.1.10")).toBe(false);
  });

  it("is false for the same version", () => {
    expect(isNewerVersion("0.1.2", "0.1.2")).toBe(false);
  });

  it("treats a release as newer than its own prerelease", () => {
    expect(isNewerVersion("0.2.0", "0.2.0-beta.1")).toBe(true);
    expect(isNewerVersion("0.2.0-beta.1", "0.2.0")).toBe(false);
    expect(isNewerVersion("0.1.2", "0.2.0-beta.1")).toBe(false);
  });

  it("is false for anything it can't parse", () => {
    expect(isNewerVersion("latest", "0.1.2")).toBe(false);
    expect(isNewerVersion("0.2", "0.1.2")).toBe(false);
    expect(isNewerVersion("0.2.0", "dev")).toBe(false);
  });
});

describe("parseLatestRelease", () => {
  const release = {
    tag_name: "app-desktop-v0.1.3",
    html_url: "https://github.com/mauriciorossdev/yggdrasilOS/releases/tag/app-desktop-v0.1.3",
    draft: false,
    prerelease: false,
  };

  it("returns the version and page of a desktop release", () => {
    expect(parseLatestRelease(release)).toEqual({ version: "0.1.3", url: release.html_url });
  });

  it("ignores other tags, drafts and prereleases", () => {
    expect(parseLatestRelease({ ...release, tag_name: "v0.1.3" })).toBeNull();
    expect(parseLatestRelease({ ...release, tag_name: "app-desktop-vnext" })).toBeNull();
    expect(parseLatestRelease({ ...release, draft: true })).toBeNull();
    expect(parseLatestRelease({ ...release, prerelease: true })).toBeNull();
  });

  it("only accepts a release page on this repo", () => {
    expect(parseLatestRelease({ ...release, html_url: "https://evil.example/releases/x" })).toBeNull();
    expect(parseLatestRelease({ ...release, html_url: undefined })).toBeNull();
  });

  it("returns null for error bodies", () => {
    expect(parseLatestRelease({ message: "API rate limit exceeded" })).toBeNull();
    expect(parseLatestRelease(null)).toBeNull();
    expect(parseLatestRelease("nope")).toBeNull();
  });
});
