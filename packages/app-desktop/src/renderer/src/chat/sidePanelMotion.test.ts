import { describe, expect, it } from "vitest";
import { clampPanelWidth, createSidePanelReducer, defaultPanelWidth, initialSidePanelState, type SidePanelState } from "./sidePanelMotion.js";

const reduce = createSidePanelReducer<string>((p) => p);
const closed = initialSidePanelState<string>();
const open = (tabs: string[], activeKey = tabs[0]!): SidePanelState<string> => ({ tabs, activeKey, phase: "open" });

describe("sidePanelReducer", () => {
  it("enters when opened from closed, then settles", () => {
    const entering = reduce(closed, { type: "open", panel: "a" });
    expect(entering).toEqual({ tabs: ["a"], activeKey: "a", phase: "enter" });
    expect(reduce(entering, { type: "settled" })).toEqual(open(["a"]));
  });

  it("adds a tab without replaying the entrance", () => {
    expect(reduce(open(["a"]), { type: "open", panel: "b" })).toEqual(open(["a", "b"], "b"));
  });

  it("opening an existing tab only activates it", () => {
    expect(reduce(open(["a", "b"], "b"), { type: "open", panel: "a" })).toEqual(open(["a", "b"], "a"));
  });

  it("closing a tab activates its neighbour", () => {
    expect(reduce(open(["a", "b", "c"], "b"), { type: "closeTab", key: "b" })).toEqual(open(["a", "c"], "c"));
    expect(reduce(open(["a", "b"], "b"), { type: "closeTab", key: "b" })).toEqual(open(["a"], "a"));
  });

  it("closing another tab keeps the active one", () => {
    expect(reduce(open(["a", "b"], "a"), { type: "closeTab", key: "b" })).toEqual(open(["a"], "a"));
  });

  it("keeps the panel mounted until the exit settles", () => {
    const exiting = reduce(open(["a"]), { type: "closeTab", key: "a" });
    expect(exiting).toEqual({ tabs: ["a"], activeKey: "a", phase: "exit" });
    expect(reduce(exiting, { type: "settled" })).toEqual(closed);
  });

  it("closing the whole panel exits with every tab still mounted", () => {
    expect(reduce(open(["a", "b"]), { type: "close" })).toEqual({ tabs: ["a", "b"], activeKey: "a", phase: "exit" });
  });

  it("enters again, with only the new tab, when reopened during the exit", () => {
    expect(reduce({ tabs: ["a", "b"], activeKey: "a", phase: "exit" }, { type: "open", panel: "c" })).toEqual({
      tabs: ["c"],
      activeKey: "c",
      phase: "enter",
    });
  });

  it("ignores close, closeTab and settled when already closed", () => {
    expect(reduce(closed, { type: "close" })).toBe(closed);
    expect(reduce(closed, { type: "closeTab", key: "a" })).toBe(closed);
    expect(reduce(closed, { type: "settled" })).toBe(closed);
  });
});

describe("panel width", () => {
  it("opens at about 45% of the window, within 420-760px", () => {
    expect(defaultPanelWidth(1600)).toBe(720);
    expect(defaultPanelWidth(800)).toBe(420);
    expect(defaultPanelWidth(3000)).toBe(760);
  });
  it("keeps a usable minimum and leaves the chat a quarter of the window", () => {
    expect(clampPanelWidth(100, 1600)).toBe(280);
    expect(clampPanelWidth(1500, 1600)).toBe(1200);
    expect(clampPanelWidth(700, 1600)).toBe(700);
  });
});
