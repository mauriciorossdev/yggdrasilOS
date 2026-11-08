import { describe, expect, it } from "vitest";
import { sidePanelReducer, type SidePanelState } from "./sidePanelMotion.js";

const closed: SidePanelState<string> = { panel: null, phase: "open" };

describe("sidePanelReducer", () => {
  it("enters when opened from closed, then settles", () => {
    const entering = sidePanelReducer(closed, { type: "open", panel: "a" });
    expect(entering).toEqual({ panel: "a", phase: "enter" });
    expect(sidePanelReducer(entering, { type: "settled" })).toEqual({ panel: "a", phase: "open" });
  });

  it("does not replay the entrance when the open panel shows something else", () => {
    expect(sidePanelReducer({ panel: "a", phase: "open" }, { type: "open", panel: "b" })).toEqual({
      panel: "b",
      phase: "open",
    });
  });

  it("keeps the panel mounted until the exit settles", () => {
    const exiting = sidePanelReducer({ panel: "a", phase: "open" }, { type: "close" });
    expect(exiting).toEqual({ panel: "a", phase: "exit" });
    expect(sidePanelReducer(exiting, { type: "settled" })).toEqual(closed);
  });

  it("enters again when reopened during the exit", () => {
    expect(sidePanelReducer({ panel: "a", phase: "exit" }, { type: "open", panel: "b" })).toEqual({
      panel: "b",
      phase: "enter",
    });
  });

  it("ignores close and settled when already closed", () => {
    expect(sidePanelReducer(closed, { type: "close" })).toBe(closed);
    expect(sidePanelReducer(closed, { type: "settled" })).toBe(closed);
  });
});
