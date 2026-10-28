import { describe, expect, it } from "vitest";
import { cliIdFromHarnessName, filterVisibleClis, isCliVisible, terminalLaunchClis } from "./harnessFilter.js";

const chosen = { enabledHarnesses: ["claude" as const], showAllClis: false };

describe("isCliVisible", () => {
  it("shows everything before the user has chosen, or with no settings loaded", () => {
    expect(isCliVisible("copilot", { enabledHarnesses: null, showAllClis: false })).toBe(true);
    expect(isCliVisible("copilot", null)).toBe(true);
  });

  it("shows only the chosen CLIs once a choice exists", () => {
    expect(isCliVisible("claude", chosen)).toBe(true);
    expect(isCliVisible("copilot", chosen)).toBe(false);
  });

  it("showAllClis overrides the choice", () => {
    expect(isCliVisible("copilot", { ...chosen, showAllClis: true })).toBe(true);
  });

  it("an explicit empty choice hides every CLI", () => {
    expect(isCliVisible("claude", { enabledHarnesses: [], showAllClis: false })).toBe(false);
  });
});

describe("filterVisibleClis", () => {
  it("never filters items that are not CLIs", () => {
    const items = ["yggdrasil", "claude", "omp", "shell"];
    const idOf = (name: string) => cliIdFromHarnessName(name);
    expect(filterVisibleClis(items, idOf, chosen)).toEqual(["yggdrasil", "claude", "shell"]);
  });
});

describe("cliIdFromHarnessName", () => {
  it("maps agy to antigravity and rejects unknown names", () => {
    expect(cliIdFromHarnessName("agy")).toBe("antigravity");
    expect(cliIdFromHarnessName("antigravity")).toBe("antigravity");
    expect(cliIdFromHarnessName("copilot")).toBe("copilot");
    expect(cliIdFromHarnessName("yggdrasil")).toBeNull();
  });
});

describe("terminalLaunchClis", () => {
  const ids = (s: Parameters<typeof terminalLaunchClis>[0]) => terminalLaunchClis(s).map((c) => c.id);

  it("keeps the single Claude Code button until the user has chosen", () => {
    expect(ids(null)).toEqual(["claude"]);
    expect(ids({ enabledHarnesses: null, showAllClis: false })).toEqual(["claude"]);
  });

  it("lists the chosen CLIs, with their launch commands", () => {
    expect(ids({ enabledHarnesses: ["copilot", "claude"], showAllClis: false })).toEqual(["claude", "copilot"]);
    expect(terminalLaunchClis({ enabledHarnesses: ["antigravity"], showAllClis: false })[0].command).toBe("agy");
  });

  it("lists all four with showAllClis, and none for an explicit empty choice", () => {
    expect(ids({ enabledHarnesses: ["claude"], showAllClis: true })).toHaveLength(4);
    expect(ids({ enabledHarnesses: [], showAllClis: false })).toEqual([]);
  });
});
