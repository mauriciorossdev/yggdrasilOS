import { describe, expect, it } from "vitest";
import { matchBrowserShortcut, nextZoomFactor, type ShortcutInput } from "./browserShortcuts.js";

function key(k: string, mods: Partial<ShortcutInput> = {}): ShortcutInput {
  return { type: "keyDown", key: k, control: false, meta: false, shift: false, alt: false, ...mods };
}

describe("matchBrowserShortcut", () => {
  it("maps Ctrl+<key> on Windows/Linux", () => {
    expect(matchBrowserShortcut(key("t", { control: true }), false)).toBe("newTab");
    expect(matchBrowserShortcut(key("w", { control: true }), false)).toBe("closeTab");
    expect(matchBrowserShortcut(key("l", { control: true }), false)).toBe("focusAddress");
    expect(matchBrowserShortcut(key("r", { control: true }), false)).toBe("reload");
    expect(matchBrowserShortcut(key("Tab", { control: true }), false)).toBe("nextTab");
  });

  it("maps Cmd+<key> on macOS and ignores Ctrl there", () => {
    expect(matchBrowserShortcut(key("t", { meta: true }), true)).toBe("newTab");
    expect(matchBrowserShortcut(key("t", { control: true }), true)).toBeNull();
    expect(matchBrowserShortcut(key("t", { meta: true }), false)).toBeNull();
  });

  it("is case-insensitive for letters (caps lock / shift state)", () => {
    expect(matchBrowserShortcut(key("T", { control: true }), false)).toBe("newTab");
  });

  it("handles shifted variants", () => {
    expect(matchBrowserShortcut(key("R", { control: true, shift: true }), false)).toBe("hardReload");
    expect(matchBrowserShortcut(key("I", { control: true, shift: true }), false)).toBe("devTools");
    expect(matchBrowserShortcut(key("Tab", { control: true, shift: true }), false)).toBe("prevTab");
    expect(matchBrowserShortcut(key("+", { control: true, shift: true }), false)).toBe("zoomIn");
  });

  it("maps zoom keys", () => {
    expect(matchBrowserShortcut(key("=", { control: true }), false)).toBe("zoomIn");
    expect(matchBrowserShortcut(key("+", { control: true }), false)).toBe("zoomIn");
    expect(matchBrowserShortcut(key("-", { control: true }), false)).toBe("zoomOut");
    expect(matchBrowserShortcut(key("0", { control: true }), false)).toBe("zoomReset");
  });

  it("maps F5, F12 and Alt+arrows without a command modifier", () => {
    expect(matchBrowserShortcut(key("F5"), false)).toBe("reload");
    expect(matchBrowserShortcut(key("F5", { control: true }), false)).toBe("hardReload");
    expect(matchBrowserShortcut(key("F12"), false)).toBe("devTools");
    expect(matchBrowserShortcut(key("ArrowLeft", { alt: true }), false)).toBe("back");
    expect(matchBrowserShortcut(key("ArrowRight", { alt: true }), false)).toBe("forward");
  });

  it("leaves everything else alone", () => {
    expect(matchBrowserShortcut(key("t"), false)).toBeNull();
    expect(matchBrowserShortcut(key("c", { control: true }), false)).toBeNull();
    expect(matchBrowserShortcut(key("t", { control: true, alt: true }), false)).toBeNull();
    expect(matchBrowserShortcut({ ...key("t", { control: true }), type: "keyUp" }, false)).toBeNull();
    expect(matchBrowserShortcut(key("ArrowLeft"), false)).toBeNull();
  });
});

describe("nextZoomFactor", () => {
  it("steps through Chrome's levels", () => {
    expect(nextZoomFactor(1, "in")).toBe(1.1);
    expect(nextZoomFactor(1, "out")).toBe(0.9);
    expect(nextZoomFactor(1.25, "in")).toBe(1.5);
  });

  it("tolerates floating-point drift", () => {
    expect(nextZoomFactor(1.0999999, "in")).toBe(1.25);
    expect(nextZoomFactor(1.1000001, "out")).toBe(1);
  });

  it("clamps at both ends", () => {
    expect(nextZoomFactor(5, "in")).toBe(5);
    expect(nextZoomFactor(0.25, "out")).toBe(0.25);
  });
});
