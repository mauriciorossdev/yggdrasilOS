import { beforeEach, describe, expect, it } from "vitest";
import {
  getScriptRuns,
  markExit,
  markRestarted,
  markStarted,
  markStopRequested,
  resetScriptRuns,
  syncOpenPanes,
} from "./scriptRuns.js";

beforeEach(resetScriptRuns);

describe("scriptRuns", () => {
  it("tracks a started script as running", () => {
    markStarted("dev", "script:1");
    expect(getScriptRuns().get("dev")).toMatchObject({ paneId: "script:1", status: "running", exitCode: null });
  });

  it("marks exit 0 as done and a crash as failed", () => {
    markStarted("build", "script:1");
    markExit("script:1", 0);
    expect(getScriptRuns().get("build")?.status).toBe("done");

    markStarted("test", "script:2");
    markExit("script:2", 1);
    expect(getScriptRuns().get("test")).toMatchObject({ status: "failed", exitCode: 1 });
  });

  it("calls any exit after Ctrl+C from the sidebar stopped (npm exits 0 on Ctrl+C)", () => {
    markStarted("dev", "script:1");
    markStopRequested("dev");
    markExit("script:1", 130);
    expect(getScriptRuns().get("dev")?.status).toBe("stopped");

    markStarted("watch", "script:2");
    markStopRequested("watch");
    markExit("script:2", 0);
    expect(getScriptRuns().get("watch")?.status).toBe("stopped");
  });

  it("ignores exits of panes that aren't scripts, and repeated exits", () => {
    markStarted("dev", "script:1");
    markExit("some-other-pane", 1);
    expect(getScriptRuns().get("dev")?.status).toBe("running");
    markExit("script:1", 0);
    markExit("script:1", 1);
    expect(getScriptRuns().get("dev")?.status).toBe("done");
  });

  it("starting again replaces the previous run (restart)", () => {
    markStarted("dev", "script:1");
    markExit("script:1", 1);
    markStarted("dev", "script:2");
    expect(getScriptRuns().get("dev")).toMatchObject({ paneId: "script:2", status: "running", stopRequested: false });
  });

  it("goes back to running when the pane's own Restart respawns it", () => {
    markStarted("fail", "script:1");
    markExit("script:1", 3);
    markRestarted("script:1");
    expect(getScriptRuns().get("fail")).toMatchObject({ status: "running", exitCode: null });
    markRestarted("not-a-script");
    expect(getScriptRuns().size).toBe(1);
  });

  it("forgets runs whose pane was closed", () => {
    markStarted("dev", "script:1");
    markStarted("build", "script:2");
    syncOpenPanes(new Set(["script:2"]));
    expect(getScriptRuns().has("dev")).toBe(false);
    expect(getScriptRuns().has("build")).toBe(true);
  });
});
