import { describe, expect, it } from "vitest";
import { initialState, tuiReducer } from "./store.js";

describe("phase 2 reducer cases", () => {
  it("keeps the session title across LOAD_SESSION and drops it for a fresh session", () => {
    const loaded = tuiReducer(initialState(), { type: "LOAD_SESSION", sessionKey: "k", messages: [], title: "Bug hunt" });
    expect(loaded.sessionTitle).toBe("Bug hunt");
    expect(tuiReducer(loaded, { type: "SET_SESSION_KEY", sessionKey: "k2" }).sessionTitle).toBeNull();
    expect(tuiReducer(loaded, { type: "LOAD_SESSION", sessionKey: "k3", messages: [] }).sessionTitle).toBeNull();
  });

  it("stores tools, turns and the workspace root", () => {
    let s = tuiReducer(initialState(), { type: "SET_TOOLS", tools: [{ name: "a", description: "d" }] });
    s = tuiReducer(s, { type: "SET_TURNS", turns: [{ sessionKey: "k", timestamp: 1 }] });
    s = tuiReducer(s, { type: "SET_WORKSPACE", workspaceRoot: "/p/app" });
    expect(s.tools).toHaveLength(1);
    expect(s.turns).toHaveLength(1);
    expect(s.workspaceRoot).toBe("/p/app");
  });

  it("puts loaded history before anything typed while it was loading", () => {
    const typed = tuiReducer(initialState(), { type: "PUSH_INPUT_HISTORY", text: "new" });
    expect(tuiReducer(typed, { type: "LOAD_INPUT_HISTORY", entries: ["old1", "old2"] }).inputHistory).toEqual(["old1", "old2", "new"]);
  });
});
