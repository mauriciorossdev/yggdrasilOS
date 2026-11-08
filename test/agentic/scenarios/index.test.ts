import { describe, expect, it } from "vitest";
import { SCENARIOS, selectScenarios } from "./index.js";

describe("scenario registry", () => {
  it("has unique ids and at least one must-check per scenario", () => {
    const ids = SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SCENARIOS) {
      expect(s.turns.length, s.id).toBeGreaterThan(0);
      expect(s.checks.some((c) => c.must), `${s.id} needs a must-check`).toBe(true);
      expect(new Set(s.checks.map((c) => c.id)).size, `${s.id} duplicate check ids`).toBe(s.checks.length);
    }
  });

  it("covers every difficulty level", () => {
    expect(new Set(SCENARIOS.map((s) => s.level))).toEqual(new Set([0, 1, 2, 3]));
  });
});

describe("selectScenarios", () => {
  it("returns everything without a filter", () => {
    expect(selectScenarios(SCENARIOS, undefined)).toHaveLength(SCENARIOS.length);
    expect(selectScenarios(SCENARIOS, "")).toHaveLength(SCENARIOS.length);
  });
  it("matches ids, id prefixes, tags and levels", () => {
    expect(selectScenarios(SCENARIOS, "hello-file").map((s) => s.id)).toEqual(["hello-file"]);
    expect(selectScenarios(SCENARIOS, "fix-").map((s) => s.id)).toEqual(["fix-failing-test", "fix-type-errors"]);
    expect(selectScenarios(SCENARIOS, "tag:safety").map((s) => s.id)).toEqual(["stay-in-workspace"]);
    expect(selectScenarios(SCENARIOS, "level:0").map((s) => s.id)).toEqual(["hello-file", "read-and-answer"]);
  });
  it("excludes with a leading dash, alone or after includes", () => {
    const noSlow = selectScenarios(SCENARIOS, "-tag:slow").map((s) => s.id);
    expect(noSlow).not.toContain("react-vite-app");
    expect(noSlow.length).toBe(SCENARIOS.length - 1);
    expect(selectScenarios(SCENARIOS, "fix-,-fix-type").map((s) => s.id)).toEqual(["fix-failing-test"]);
  });
});
