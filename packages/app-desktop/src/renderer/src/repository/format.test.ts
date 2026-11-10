import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initials, relativeTime, repoToProjectPath, splitPath } from "./format.js";
import { setLanguage } from "../i18n/index.js";

const NOW = Date.parse("2026-10-31T12:00:00Z");

beforeAll(() => setLanguage("es"));
afterAll(() => setLanguage("en"));

describe("relativeTime", () => {
  it("buckets by unit", () => {
    expect(relativeTime("2026-10-31T11:59:40Z", NOW)).toBe("ahora");
    expect(relativeTime("2026-10-31T11:15:00Z", NOW)).toBe("hace 45 min");
    expect(relativeTime("2026-10-31T09:00:00Z", NOW)).toBe("hace 3 h");
    expect(relativeTime("2026-10-30T11:00:00Z", NOW)).toBe("hace 1 día");
    expect(relativeTime("2026-10-28T12:00:00Z", NOW)).toBe("hace 3 días");
    expect(relativeTime("2026-08-31T12:00:00Z", NOW)).toBe("hace 2 meses");
    expect(relativeTime("2024-10-31T12:00:00Z", NOW)).toBe("hace 2 años");
  });
  it("speaks English when the UI is English", () => {
    setLanguage("en");
    expect(relativeTime("2026-10-28T12:00:00Z", NOW)).toBe("3 days ago");
    expect(relativeTime("2026-10-30T11:00:00Z", NOW)).toBe("1 day ago");
    setLanguage("es");
  });
  it("returns garbage as-is", () => {
    expect(relativeTime("nope", NOW)).toBe("nope");
  });
});

describe("initials / splitPath", () => {
  it("takes first and last word", () => {
    expect(initials("alex rivera")).toBe("AR");
    expect(initials("alex")).toBe("A");
    expect(initials("  ")).toBe("?");
  });
  it("splits dir and file", () => {
    expect(splitPath("a/b/c.ts")).toEqual({ dir: "a/b/", file: "c.ts" });
    expect(splitPath("c.ts")).toEqual({ dir: "", file: "c.ts" });
  });
});

describe("repoToProjectPath", () => {
  it("keeps paths when the project is the repo root", () => {
    expect(repoToProjectPath("src/a.ts", "")).toBe("src/a.ts");
    expect(repoToProjectPath("src/a.ts", ".")).toBe("src/a.ts");
  });
  it("strips the project's folder inside the repo, or says it is outside", () => {
    expect(repoToProjectPath("packages/x/src/a.ts", "packages/x")).toBe("src/a.ts");
    expect(repoToProjectPath("packages/xy/a.ts", "packages/x")).toBeUndefined();
    expect(repoToProjectPath("README.md", "packages/x")).toBeUndefined();
  });
});
