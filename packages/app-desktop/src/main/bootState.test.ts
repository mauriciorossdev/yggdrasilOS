import { describe, expect, it } from "vitest";
import { advance, bootReady, failBoot, finishStage, initialBoot, openedSnapshot, resetForRetry, startStage, toWire } from "./bootState.js";

describe("bootState", () => {
  it("at launch, the app's own startup comes first as live stages", () => {
    expect(initialBoot("launch").stages.map((st) => st.id)).toEqual(["settings", "plugins", "folder", "gateway", "agents", "connect"]);
    expect(initialBoot("project").stages.map((st) => st.id)).toEqual(["folder", "gateway", "agents", "connect"]);
    expect(initialBoot("launch").stages.every((st) => st.state === "pending")).toBe(true);
  });

  it("advance finishes the running stage and starts the next", () => {
    let s = advance(initialBoot("launch"), "settings", 0);
    s = advance(s, "plugins", 2600);
    expect(toWire(s).stages.slice(0, 2)).toEqual([
      { id: "settings", state: "done", ms: 2600 },
      { id: "plugins", state: "active" },
    ]);
  });

  it("times a stage from start to finish", () => {
    let s = startStage(initialBoot("project"), "gateway", 1000);
    expect(s.stages[1].state).toBe("active");
    s = finishStage(s, "gateway", 2384);
    expect(toWire(s).stages[1]).toEqual({ id: "gateway", state: "done", ms: 1384 });
  });

  it("fails the running stage and keeps the rest pending", () => {
    let s = finishStage(startStage(initialBoot("project"), "folder", 0), "folder", 5);
    s = failBoot(startStage(s, "gateway", 10), { message: "boom", detail: "EADDRINUSE" });
    expect(s.stages.map((st) => st.state)).toEqual(["done", "failed", "pending", "pending"]);
    expect(s.error).toEqual({ message: "boom", detail: "EADDRINUSE" });
  });

  it("ready hands the gateway over and makes connect the running stage", () => {
    const s = bootReady(initialBoot("project"), { url: "ws://127.0.0.1:1", lanUrl: "ws://10.0.0.2:1" }, 0);
    expect(s.gateway?.url).toBe("ws://127.0.0.1:1");
    expect(s.stages.find((st) => st.id === "connect")?.state).toBe("active");
  });

  it("retry resets every stage that didn't finish", () => {
    let s = advance(advance(initialBoot("launch"), "settings", 0), "plugins", 5);
    s = failBoot(advance(s, "gateway", 9), { message: "x" });
    const r = resetForRetry(s);
    expect(r.error).toBeNull();
    expect(r.stages.map((st) => st.state)).toEqual(["done", "done", "pending", "pending", "pending", "pending"]);
  });

  it("an already-open window reconnects straight away", () => {
    const s = openedSnapshot({ url: "ws://a", lanUrl: "ws://b" });
    expect(s.stages.filter((st) => st.state !== "done").map((st) => st.id)).toEqual(["connect"]);
  });
});
