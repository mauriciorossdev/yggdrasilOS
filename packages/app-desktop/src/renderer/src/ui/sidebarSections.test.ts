import { describe, expect, it } from "vitest";
import { initialSectionOpen, loadSectionStates, saveSectionState } from "./sidebarSections.js";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

describe("sidebar section state", () => {
  it("falls back to the section's default until it is toggled", () => {
    const s = fakeStorage();
    expect(initialSectionOpen(s, "p1", "files", false)).toBe(false);
    expect(initialSectionOpen(s, "p1", "plugins", true)).toBe(true);
  });

  it("remembers each section, and a closed default can be opened and vice versa", () => {
    const s = fakeStorage();
    saveSectionState(s, "p1", "files", true);
    saveSectionState(s, "p1", "plugins", false);
    expect(initialSectionOpen(s, "p1", "files", false)).toBe(true);
    expect(initialSectionOpen(s, "p1", "plugins", true)).toBe(false);
    expect(loadSectionStates(s, "p1")).toEqual({ files: true, plugins: false });
  });

  it("keeps projects apart", () => {
    const s = fakeStorage();
    saveSectionState(s, "p1", "files", true);
    expect(initialSectionOpen(s, "p2", "files", false)).toBe(false);
  });

  it("a section without an id isn't remembered", () => {
    const s = fakeStorage();
    expect(initialSectionOpen(s, "p1", undefined, true)).toBe(true);
  });

  it("ignores corrupt or oddly shaped saved data", () => {
    expect(loadSectionStates(fakeStorage({ "ygg.sidebar.sections.p1": "not json" }), "p1")).toEqual({});
    expect(loadSectionStates(fakeStorage({ "ygg.sidebar.sections.p1": "[true]" }), "p1")).toEqual({});
    expect(loadSectionStates(fakeStorage({ "ygg.sidebar.sections.p1": '{"files":"yes","plugins":true}' }), "p1")).toEqual({ plugins: true });
  });

  it("survives storage that throws or is missing", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(initialSectionOpen(broken, "p1", "files", true)).toBe(true);
    expect(() => saveSectionState(broken, "p1", "files", false)).not.toThrow();
    expect(initialSectionOpen(undefined, "p1", "files", false)).toBe(false);
  });
});
