import { describe, expect, it } from "vitest";
import { clampWorkspaceWidth, defaultWorkspaceWidth, MIN_CHAT, MIN_WORKSPACE } from "./splitWidth.js";

describe("workspace width", () => {
  it("opens at about half the container", () => {
    expect(defaultWorkspaceWidth(1400)).toBe(700);
  });
  it("never lets the chat drop below its minimum", () => {
    expect(clampWorkspaceWidth(5000, 1000)).toBe(1000 - MIN_CHAT);
  });
  it("never makes the workspace narrower than its minimum", () => {
    expect(clampWorkspaceWidth(50, 1400)).toBe(MIN_WORKSPACE);
  });
  it("still returns something sane in a very narrow window", () => {
    expect(clampWorkspaceWidth(500, 500)).toBe(MIN_WORKSPACE);
  });
});
