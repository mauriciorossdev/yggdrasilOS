import { describe, expect, it } from "vitest";
import { pickFilterBox } from "./filterShortcut.js";

describe("pickFilterBox", () => {
  it("prefers the higher priority among the visible ones", () => {
    expect(
      pickFilterBox([
        { id: 1, priority: 0, visible: true },
        { id: 2, priority: 1, visible: true },
      ]),
    ).toBe(2);
  });

  it("ignores a box that isn't showing, whatever its priority", () => {
    expect(
      pickFilterBox([
        { id: 1, priority: 0, visible: true },
        { id: 2, priority: 5, visible: false },
      ]),
    ).toBe(1);
  });

  it("breaks ties with the first registered, and gives nothing when none shows", () => {
    expect(
      pickFilterBox([
        { id: 7, priority: 0, visible: true },
        { id: 8, priority: 0, visible: true },
      ]),
    ).toBe(7);
    expect(pickFilterBox([{ id: 1, priority: 0, visible: false }])).toBeUndefined();
    expect(pickFilterBox([])).toBeUndefined();
  });
});
